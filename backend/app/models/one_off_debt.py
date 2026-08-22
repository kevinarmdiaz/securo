import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class OneOffDebt(Base):
    """Deudas o pagos únicos del mes que NO son ni loan ni TC (SOAT, impuestos, viajes, DIAN, cursos)."""
    __tablename__ = "one_off_debts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    entity: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # "DIAN", "Runt", "Focus", etc.
    amount: Mapped[Decimal] = mapped_column(Numeric(precision=15, scale=2))
    currency: Mapped[str] = mapped_column(String(3), default="COP")
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # fecha límite si aplica
    target_month: Mapped[date] = mapped_column(Date)  # mes en el que Kevin quiere pagarlo (día 1)
    priority: Mapped[str] = mapped_column(String(20), default="normal")  # critical, high, normal, low
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    paid: Mapped[bool] = mapped_column(Boolean, default=False)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_transaction_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship()
