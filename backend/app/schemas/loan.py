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
    start_date: date
    currency: str
    status: str
    created_at: datetime
    updated_at: datetime

    # Computed
    total_remaining_payments: int = 0
    total_interest_remaining: Decimal = Decimal("0")
    projected_end_date: Optional[date] = None

    model_config = ConfigDict(from_attributes=True)


class AmortizationRow(BaseModel):
    period: int
    payment_date: date
    opening_balance: Decimal
    payment: Decimal
    interest: Decimal
    principal: Decimal
    closing_balance: Decimal


class AmortizationTable(BaseModel):
    loan_id: uuid.UUID
    name: str
    entity: str
    currency: str
    monthly_rate: Decimal
    monthly_payment: Decimal
    rows: list[AmortizationRow]
    total_payments: Decimal
    total_interest: Decimal
    total_principal: Decimal
    periods: int
