import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


VALID_RATE_TYPES = (
    "compra_pesos",
    "avance_pesos",
    "mora_pesos",
    "compra_dolares",
    "avance_dolares",
    "mora_dolares",
    "otro",
)


class InterestRateCreate(BaseModel):
    entity: str
    product_name: str
    rate_type: str
    currency: str = "COP"
    ea: Decimal
    mv: Decimal
    valid_from: date
    valid_to: Optional[date] = None
    source_url: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("rate_type")
    @classmethod
    def validate_rate_type(cls, v: str) -> str:
        if v not in VALID_RATE_TYPES:
            raise ValueError(f"rate_type debe ser uno de: {', '.join(VALID_RATE_TYPES)}")
        return v

    @field_validator("ea", "mv")
    @classmethod
    def validate_rate_range(cls, v: Decimal) -> Decimal:
        if v <= 0 or v >= 100:
            raise ValueError("Las tasas deben estar entre 0 y 100 (porcentaje)")
        return v


class InterestRateUpdate(BaseModel):
    entity: Optional[str] = None
    product_name: Optional[str] = None
    rate_type: Optional[str] = None
    currency: Optional[str] = None
    ea: Optional[Decimal] = None
    mv: Optional[Decimal] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    source_url: Optional[str] = None
    notes: Optional[str] = None


class InterestRateRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    entity: str
    product_name: str
    rate_type: str
    currency: str
    ea: Decimal
    mv: Decimal
    valid_from: date
    valid_to: Optional[date] = None
    source_url: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
