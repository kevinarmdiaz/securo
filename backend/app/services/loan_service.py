import calendar
import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.loan import Loan
from app.schemas.loan import AmortizationRow, AmortizationTable, LoanCreate, LoanRead, LoanUpdate


def _next_month(d: date) -> date:
    month = d.month % 12 + 1
    year = d.year + (1 if d.month == 12 else 0)
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _compute_amortization(
    loan: Loan,
) -> AmortizationTable:
    """
    Genera la tabla de amortización mes a mes desde el saldo actual.
    Sistema francés: cuota fija, intereses decrecientes, capital creciente.
    """
    rate = loan.monthly_rate / Decimal("100")
    payment = loan.monthly_payment
    balance = loan.current_balance
    currency = loan.currency

    rows: list[AmortizationRow] = []
    total_interest = Decimal("0")
    total_principal = Decimal("0")
    period = 1
    payment_date = loan.start_date

    while balance > Decimal("0"):
        interest = (balance * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        principal = min(payment - interest, balance)

        # Cuota puede ser mayor al saldo restante en la última cuota
        actual_payment = (principal + interest).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        closing = (balance - principal).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        rows.append(
            AmortizationRow(
                period=period,
                payment_date=payment_date,
                opening_balance=balance.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                payment=actual_payment,
                interest=interest,
                principal=principal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                closing_balance=max(closing, Decimal("0")),
            )
        )

        total_interest += interest
        total_principal += principal
        balance = max(closing, Decimal("0"))
        period += 1
        payment_date = _next_month(payment_date)

        # Guardia: evitar loop infinito si la cuota no cubre intereses
        if payment <= interest and balance > Decimal("0"):
            raise ValueError(
                f"La cuota mensual ({payment}) no cubre los intereses ({interest}). "
                "Aumenta la cuota o revisa la tasa."
            )

    total_payments = total_interest + total_principal

    return AmortizationTable(
        loan_id=loan.id,
        name=loan.name,
        entity=loan.entity,
        currency=currency,
        monthly_rate=loan.monthly_rate,
        monthly_payment=payment,
        rows=rows,
        total_payments=total_payments.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        total_interest=total_interest.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        total_principal=total_principal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        periods=len(rows),
    )


def _enrich_loan_read(loan: Loan) -> LoanRead:
    table = _compute_amortization(loan)
    return LoanRead(
        id=loan.id,
        user_id=loan.user_id,
        name=loan.name,
        entity=loan.entity,
        current_balance=loan.current_balance,
        monthly_rate=loan.monthly_rate,
        monthly_payment=loan.monthly_payment,
        start_date=loan.start_date,
        currency=loan.currency,
        status=loan.status,
        created_at=loan.created_at,
        updated_at=loan.updated_at,
        total_remaining_payments=table.periods,
        total_interest_remaining=table.total_interest,
        projected_end_date=table.rows[-1].payment_date if table.rows else None,
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
    q = q.order_by(Loan.created_at.desc())
    result = await session.execute(q)
    loans = result.scalars().all()
    return [_enrich_loan_read(loan) for loan in loans]


async def get_loan(
    session: AsyncSession,
    loan_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Optional[Loan]:
    result = await session.execute(
        select(Loan).where(
            Loan.id == loan_id,
            Loan.workspace_id == workspace_id,
            Loan.user_id == user_id,
        )
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
    return _enrich_loan_read(loan)


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
    await session.refresh(loan)
    return _enrich_loan_read(loan)


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
    return _compute_amortization(loan)
