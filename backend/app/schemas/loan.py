import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class LoanCreate(BaseModel):
    name: str
    entity: str
    current_balance: Decimal
    monthly_rate: Decimal  # tasa mensual en % ej: 1.16
    monthly_payment: Decimal
    insurance_amount: Decimal = Decimal("0")
    original_balance: Optional[Decimal] = None
    start_date: date
    currency: str = "COP"

    @field_validator("monthly_rate")
    @classmethod
    def validate_rate(cls, v: Decimal) -> Decimal:
        if v <= 0 or v >= 100:
            raise ValueError("monthly_rate debe estar entre 0 y 100")
        return v

    @field_validator("monthly_payment", "current_balance")
    @classmethod
    def validate_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("El valor debe ser mayor a 0")
        return v


class LoanUpdate(BaseModel):
    name: Optional[str] = None
    entity: Optional[str] = None
    current_balance: Optional[Decimal] = None
    monthly_rate: Optional[Decimal] = None
    monthly_payment: Optional[Decimal] = None
    insurance_amount: Optional[Decimal] = None
    original_balance: Optional[Decimal] = None
    start_date: Optional[date] = None
    currency: Optional[str] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("active", "paid", "paused"):
            raise ValueError("status debe ser active, paid o paused")
        return v


class LoanRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    entity: str
    current_balance: Decimal
    monthly_rate: Decimal
    monthly_payment: Decimal
    insurance_amount: Decimal = Decimal("0")
    original_balance: Optional[Decimal] = None
    start_date: date
    currency: str
    status: str
    created_at: datetime
    updated_at: datetime

    # Computed
    total_remaining_payments: int = 0
    total_interest_remaining: Decimal = Decimal("0")
    projected_end_date: Optional[date] = None
    # Saldo vigente: ultimo balance_after registrado, o current_balance si no hay pagos
    effective_balance: Decimal = Decimal("0")
    payments_count: int = 0
    last_payment_date: Optional[date] = None

    model_config = ConfigDict(from_attributes=True)


class AmortizationRow(BaseModel):
    period: int
    payment_date: date
    opening_balance: Decimal
    payment: Decimal
    interest: Decimal
    principal: Decimal
    closing_balance: Decimal
    insurance: Decimal = Decimal("0")
    # False = proyeccion teorica; True = pago real registrado
    is_actual: bool = False
    kind: str = "installment"
    note: Optional[str] = None


class LoanPaymentCreate(BaseModel):
    payment_date: date
    amount: Decimal
    principal: Decimal = Decimal("0")
    interest: Decimal = Decimal("0")
    insurance: Decimal = Decimal("0")
    balance_after: Optional[Decimal] = None
    kind: str = "installment"
    note: Optional[str] = None

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("El monto debe ser mayor a 0")
        return v

    @field_validator("kind")
    @classmethod
    def validate_kind(cls, v: str) -> str:
        if v not in ("installment", "extra_principal"):
            raise ValueError("kind debe ser installment o extra_principal")
        return v


class LoanPaymentUpdate(BaseModel):
    payment_date: Optional[date] = None
    amount: Optional[Decimal] = None
    principal: Optional[Decimal] = None
    interest: Optional[Decimal] = None
    insurance: Optional[Decimal] = None
    balance_after: Optional[Decimal] = None
    kind: Optional[str] = None
    note: Optional[str] = None


class LoanPaymentRead(BaseModel):
    id: uuid.UUID
    loan_id: uuid.UUID
    payment_date: date
    amount: Decimal
    principal: Decimal
    interest: Decimal
    insurance: Decimal
    balance_after: Optional[Decimal] = None
    kind: str
    note: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MonthlyCompliance(BaseModel):
    """Cuanto entro cada mes contra la cuota pactada."""

    month: str  # YYYY-MM
    paid: Decimal
    expected: Decimal
    gap: Decimal  # positivo = falto plata ese mes
    covered: bool


class PlanVsActual(BaseModel):
    """Lo que el plan original esperaba contra lo que realmente entro."""

    payments_recorded: int
    first_payment_date: Optional[date] = None
    last_payment_date: Optional[date] = None
    months_elapsed: int = 0
    total_paid: Decimal = Decimal("0")
    total_principal_paid: Decimal = Decimal("0")
    total_interest_paid: Decimal = Decimal("0")
    total_insurance_paid: Decimal = Decimal("0")
    average_monthly_paid: Decimal = Decimal("0")
    # Cuota pactada x meses transcurridos
    expected_paid_to_date: Decimal = Decimal("0")
    payment_gap: Decimal = Decimal("0")  # positivo = falto plata
    # Saldo si se hubiera pagado al pie de la letra, contra el saldo real
    balance_if_on_plan: Optional[Decimal] = None
    actual_balance: Decimal = Decimal("0")
    balance_gap: Decimal = Decimal("0")  # positivo = se debe mas de lo planeado
    on_track: bool = True
    # Mes a mes: el agregado esconde si un mes bueno tapa varios flojos
    monthly: list[MonthlyCompliance] = []
    months_short: int = 0
    consecutive_months_short: int = 0
    total_shortfall: Decimal = Decimal("0")


class AmortizationTable(BaseModel):
    loan_id: uuid.UUID
    name: str
    entity: str
    currency: str
    monthly_rate: Decimal
    monthly_payment: Decimal
    insurance_amount: Decimal = Decimal("0")
    rows: list[AmortizationRow]
    total_payments: Decimal
    total_interest: Decimal
    total_principal: Decimal
    periods: int
    # Tramo historico (pagos reales) separado del proyectado
    actual_rows: list[AmortizationRow] = []
    starting_balance: Decimal = Decimal("0")
    plan_vs_actual: Optional[PlanVsActual] = None
