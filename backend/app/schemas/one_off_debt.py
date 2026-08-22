import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


VALID_PRIORITIES = ("critical", "high", "normal", "low")


class OneOffDebtCreate(BaseModel):
    name: str
    entity: Optional[str] = None
    amount: Decimal
    currency: str = "COP"
    due_date: Optional[date] = None
    target_month: date  # día 1 del mes objetivo
    priority: str = "normal"
    notes: Optional[str] = None

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("amount debe ser mayor a 0")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        if v not in VALID_PRIORITIES:
            raise ValueError(f"priority debe ser uno de {VALID_PRIORITIES}")
        return v


class OneOffDebtUpdate(BaseModel):
    name: Optional[str] = None
    entity: Optional[str] = None
    amount: Optional[Decimal] = None
    currency: Optional[str] = None
    due_date: Optional[date] = None
    target_month: Optional[date] = None
    priority: Optional[str] = None
    notes: Optional[str] = None
    paid: Optional[bool] = None
    paid_transaction_id: Optional[uuid.UUID] = None

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_PRIORITIES:
            raise ValueError(f"priority debe ser uno de {VALID_PRIORITIES}")
        return v


class OneOffDebtRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    entity: Optional[str]
    amount: Decimal
    currency: str
    due_date: Optional[date]
    target_month: date
    priority: str
    notes: Optional[str]
    paid: bool
    paid_at: Optional[datetime]
    paid_transaction_id: Optional[uuid.UUID]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
