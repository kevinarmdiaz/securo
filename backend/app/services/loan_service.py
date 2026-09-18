import calendar
import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.loan import Loan, LoanPayment
from app.schemas.loan import (
    AmortizationRow,
    AmortizationTable,
    LoanCreate,
    LoanPaymentCreate,
    LoanPaymentUpdate,
    LoanRead,
    LoanUpdate,
    MonthlyCompliance,
    PlanVsActual,
)


def _next_month(d: date) -> date:
    month = d.month % 12 + 1
    year = d.year + (1 if d.month == 12 else 0)
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def _q(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _effective_balance(loan: Loan, payments: list[LoanPayment]) -> Decimal:
    """
    Saldo vigente. El ultimo balance_after reportado por la entidad manda; si no
    hay ninguno, se arrastra el capital abonado contra current_balance.
    """
    if not payments:
        return loan.current_balance
    with_balance = [p for p in payments if p.balance_after is not None]
    if with_balance:
        return with_balance[-1].balance_after
    base = loan.original_balance or loan.current_balance
    return max(base - sum((p.principal for p in payments), Decimal("0")), Decimal("0"))


def _project(
    balance: Decimal,
    rate: Decimal,
    payment: Decimal,
    insurance: Decimal,
    first_date: date,
    start_period: int,
) -> list[AmortizationRow]:
    """
    Proyeccion mes a mes desde un saldo dado. Sistema frances: la cuota cubre
    primero seguro e intereses, el resto va a capital.
    """
    rows: list[AmortizationRow] = []
    period = start_period
    payment_date = first_date
    guard = 0

    while balance > Decimal("0") and guard < 600:
        guard += 1
        interest = _q(balance * rate)
        available = payment - interest - insurance
        if available <= Decimal("0"):
            raise ValueError(
                f"La cuota ({payment}) no cubre intereses ({interest}) mas seguro ({insurance}). "
                "Aumenta la cuota o revisa la tasa."
            )
        principal = min(available, balance)
        closing = max(_q(balance - principal), Decimal("0"))

        rows.append(
            AmortizationRow(
                period=period,
                payment_date=payment_date,
                opening_balance=_q(balance),
                payment=_q(principal + interest + insurance),
                interest=interest,
                principal=_q(principal),
                insurance=insurance,
                closing_balance=closing,
                is_actual=False,
            )
        )
        balance = closing
        period += 1
        payment_date = _next_month(payment_date)

    return rows


def _build_plan_vs_actual(
    loan: Loan, payments: list[LoanPayment], effective: Decimal
) -> Optional[PlanVsActual]:
    if not payments:
        return None

    rate = loan.monthly_rate / Decimal("100")
    first = payments[0].payment_date
    last = payments[-1].payment_date
    # +1 porque el primer pago ya cuenta como un mes cubierto
    months = _months_between(first, last) + 1

    total_paid = sum((p.amount for p in payments), Decimal("0"))
    total_principal = sum((p.principal for p in payments), Decimal("0"))
    total_interest = sum((p.interest for p in payments), Decimal("0"))
    total_insurance = sum((p.insurance for p in payments), Decimal("0"))

    expected = loan.monthly_payment * months

    # Saldo teorico si se hubiera pagado la cuota pactada cada mes desde el arranque
    balance_if_on_plan: Optional[Decimal] = None
    base = loan.original_balance
    if base is not None:
        b = base
        for _ in range(months):
            interest = _q(b * rate)
            principal = loan.monthly_payment - interest - loan.insurance_amount
            if principal <= Decimal("0"):
                b = None
                break
            b = max(_q(b - min(principal, b)), Decimal("0"))
        balance_if_on_plan = b

    # Mes a mes: agrupamos por mes calendario y comparamos contra la cuota pactada
    by_month: dict[str, Decimal] = {}
    for p in payments:
        key = p.payment_date.strftime("%Y-%m")
        by_month[key] = by_month.get(key, Decimal("0")) + p.amount

    monthly: list[MonthlyCompliance] = []
    cursor = date(first.year, first.month, 1)
    end = date(last.year, last.month, 1)
    while cursor <= end:
        key = cursor.strftime("%Y-%m")
        paid = by_month.get(key, Decimal("0"))
        gap = _q(loan.monthly_payment - paid)
        monthly.append(
            MonthlyCompliance(
                month=key,
                paid=_q(paid),
                expected=_q(loan.monthly_payment),
                gap=gap,
                covered=gap <= Decimal("0"),
            )
        )
        cursor = _next_month(cursor)

    months_short = sum(1 for m in monthly if not m.covered)
    total_shortfall = _q(sum((m.gap for m in monthly if m.gap > 0), Decimal("0")))
    streak = 0
    for m in reversed(monthly):
        if m.covered:
            break
        streak += 1

    payment_gap = _q(expected - total_paid)
    balance_gap = _q(effective - balance_if_on_plan) if balance_if_on_plan is not None else Decimal("0")

    return PlanVsActual(
        payments_recorded=len(payments),
        first_payment_date=first,
        last_payment_date=last,
        months_elapsed=months,
        total_paid=_q(total_paid),
        total_principal_paid=_q(total_principal),
        total_interest_paid=_q(total_interest),
        total_insurance_paid=_q(total_insurance),
        average_monthly_paid=_q(total_paid / months) if months else Decimal("0"),
        expected_paid_to_date=_q(expected),
        payment_gap=payment_gap,
        balance_if_on_plan=balance_if_on_plan,
        actual_balance=_q(effective),
        balance_gap=balance_gap,
        # Un mes grande no compensa: si hay meses cortos, no va al dia
        on_track=months_short == 0,
        monthly=monthly,
        months_short=months_short,
        consecutive_months_short=streak,
        total_shortfall=total_shortfall,
    )


def _compute_amortization(loan: Loan, payments: Optional[list[LoanPayment]] = None) -> AmortizationTable:
    """
    Tabla de amortizacion dinamica: los pagos reales registrados forman el tramo
    historico, y la proyeccion arranca desde el saldo que dejaron.
    """
    payments = sorted(payments or [], key=lambda p: p.payment_date)
    rate = loan.monthly_rate / Decimal("100")
    insurance = loan.insurance_amount or Decimal("0")

    actual_rows: list[AmortizationRow] = []
    running = loan.original_balance if (loan.original_balance and payments) else None

    for idx, p in enumerate(payments, start=1):
        opening = running if running is not None else Decimal("0")
        closing = p.balance_after if p.balance_after is not None else _q(opening - p.principal)
        if running is None:
            # Sin saldo de arranque conocido, reconstruimos hacia atras desde el reportado
            opening = _q(closing + p.principal)
        actual_rows.append(
            AmortizationRow(
                period=idx,
                payment_date=p.payment_date,
                opening_balance=_q(opening),
                payment=_q(p.amount),
                interest=_q(p.interest),
                principal=_q(p.principal),
                insurance=_q(p.insurance),
                closing_balance=_q(closing),
                is_actual=True,
                kind=p.kind,
                note=p.note,
            )
        )
        running = closing

    effective = _effective_balance(loan, payments)

    if payments:
        first_projected = _next_month(payments[-1].payment_date)
    else:
        first_projected = loan.start_date

    projected = _project(
        balance=effective,
        rate=rate,
        payment=loan.monthly_payment,
        insurance=insurance,
        first_date=first_projected,
        start_period=len(actual_rows) + 1,
    )

    total_interest = sum((r.interest for r in projected), Decimal("0"))
    total_principal = sum((r.principal for r in projected), Decimal("0"))
    total_insurance = sum((r.insurance for r in projected), Decimal("0"))

    return AmortizationTable(
        loan_id=loan.id,
        name=loan.name,
        entity=loan.entity,
        currency=loan.currency,
        monthly_rate=loan.monthly_rate,
        monthly_payment=loan.monthly_payment,
        insurance_amount=insurance,
        rows=projected,
        actual_rows=actual_rows,
        starting_balance=_q(effective),
        total_payments=_q(total_interest + total_principal + total_insurance),
        total_interest=_q(total_interest),
        total_principal=_q(total_principal),
        periods=len(projected),
        plan_vs_actual=_build_plan_vs_actual(loan, payments, effective),
    )


def _enrich_loan_read(loan: Loan, payments: Optional[list[LoanPayment]] = None) -> LoanRead:
    payments = sorted(payments or [], key=lambda p: p.payment_date)
    table = _compute_amortization(loan, payments)
    return LoanRead(
        id=loan.id,
        user_id=loan.user_id,
        name=loan.name,
        entity=loan.entity,
        current_balance=loan.current_balance,
        monthly_rate=loan.monthly_rate,
        monthly_payment=loan.monthly_payment,
        insurance_amount=loan.insurance_amount or Decimal("0"),
        original_balance=loan.original_balance,
        start_date=loan.start_date,
        currency=loan.currency,
        status=loan.status,
        created_at=loan.created_at,
        updated_at=loan.updated_at,
        total_remaining_payments=table.periods,
        total_interest_remaining=table.total_interest,
        projected_end_date=table.rows[-1].payment_date if table.rows else None,
        effective_balance=table.starting_balance,
        payments_count=len(payments),
        last_payment_date=payments[-1].payment_date if payments else None,
    )


async def get_loans(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    status: Optional[str] = None,
) -> list[LoanRead]:
    q = select(Loan).where(Loan.workspace_id == workspace_id, Loan.user_id == user_id)
    if status:
        q = q.where(Loan.status == status)
    q = q.order_by(Loan.created_at.desc()).options(selectinload(Loan.payments))
    result = await session.execute(q)
    loans = result.scalars().unique().all()
    return [_enrich_loan_read(loan, list(loan.payments)) for loan in loans]


async def get_loan(
    session: AsyncSession,
    loan_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Optional[Loan]:
    result = await session.execute(
        select(Loan)
        .where(
            Loan.id == loan_id,
            Loan.workspace_id == workspace_id,
            Loan.user_id == user_id,
        )
        .options(selectinload(Loan.payments))
    )
    return result.scalar_one_or_none()


async def create_loan(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LoanCreate,
) -> LoanRead:
    loan = Loan(
        workspace_id=workspace_id,
        user_id=user_id,
        **data.model_dump(),
    )
    session.add(loan)
    await session.commit()
    await session.refresh(loan)
    return _enrich_loan_read(loan, [])


async def update_loan(
    session: AsyncSession,
    loan_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LoanUpdate,
) -> Optional[LoanRead]:
    loan = await get_loan(session, loan_id, workspace_id, user_id)
    if not loan:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(loan, field, value)
    await session.commit()
    # commit() expira los atributos: recargar entero, no solo la relacion, o
    # leer una columna en codigo sincrono dispara IO fuera del contexto async.
    loan = await get_loan(session, loan_id, workspace_id, user_id)
    return _enrich_loan_read(loan, list(loan.payments))


async def delete_loan(
    session: AsyncSession,
    loan_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> bool:
    result = await session.execute(
        select(Loan).where(Loan.id == loan_id, Loan.workspace_id == workspace_id)
    )
    loan = result.scalar_one_or_none()
    if not loan:
        return False
    await session.delete(loan)
    await session.commit()
    return True


async def get_amortization_table(
    session: AsyncSession,
    loan_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Optional[AmortizationTable]:
    loan = await get_loan(session, loan_id, workspace_id, user_id)
    if not loan:
        return None
    return _compute_amortization(loan, list(loan.payments))


async def list_payments(
    session: AsyncSession,
    loan_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Optional[list[LoanPayment]]:
    loan = await get_loan(session, loan_id, workspace_id, user_id)
    if not loan:
        return None
    return sorted(loan.payments, key=lambda p: p.payment_date)


async def _sync_current_balance(
    session: AsyncSession,
    loan_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Deja current_balance alineado con lo que dicen los pagos registrados."""
    loan = await get_loan(session, loan_id, workspace_id, user_id)
    if not loan:
        return
    loan.current_balance = _effective_balance(
        loan, sorted(loan.payments, key=lambda p: p.payment_date)
    )
    await session.commit()


async def add_payment(
    session: AsyncSession,
    loan_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LoanPaymentCreate,
) -> Optional[LoanPayment]:
    loan = await get_loan(session, loan_id, workspace_id, user_id)
    if not loan:
        return None
    payment = LoanPayment(
        loan_id=loan.id,
        user_id=user_id,
        workspace_id=workspace_id,
        **data.model_dump(),
    )
    session.add(payment)
    await session.commit()
    payment_id = payment.id
    await _sync_current_balance(session, loan_id, workspace_id, user_id)
    return await session.get(LoanPayment, payment_id)


async def update_payment(
    session: AsyncSession,
    loan_id: uuid.UUID,
    payment_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    data: LoanPaymentUpdate,
) -> Optional[LoanPayment]:
    loan = await get_loan(session, loan_id, workspace_id, user_id)
    if not loan:
        return None
    payment = next((p for p in loan.payments if p.id == payment_id), None)
    if not payment:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(payment, field, value)
    await session.commit()
    await _sync_current_balance(session, loan_id, workspace_id, user_id)
    return await session.get(LoanPayment, payment_id)


async def delete_payment(
    session: AsyncSession,
    loan_id: uuid.UUID,
    payment_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> bool:
    loan = await get_loan(session, loan_id, workspace_id, user_id)
    if not loan:
        return False
    payment = next((p for p in loan.payments if p.id == payment_id), None)
    if not payment:
        return False
    await session.delete(payment)
    await session.commit()
    await _sync_current_balance(session, loan_id, workspace_id, user_id)
    return True
