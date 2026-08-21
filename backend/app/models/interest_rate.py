import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class InterestRateHistory(Base):
    """
    Histórico de tasas de interés publicadas por entidades financieras.
    Se pobla manualmente o por cron (Celery beat) que descarga PDFs oficiales.
    """
    __tablename__ = "interest_rate_history"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "entity", "product_name", "rate_type", "valid_from",
            name="uq_rate_period",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    entity: Mapped[str] = mapped_column(String(255), index=True)                 # ej: Banco de Occidente
    product_name: Mapped[str] = mapped_column(String(255), index=True)           # ej: Credencial Clásica Mastercard
    rate_type: Mapped[str] = mapped_column(String(50), index=True)               # compra_pesos | avance_pesos | mora_pesos | compra_dolares | ...
    currency: Mapped[str] = mapped_column(String(3), default="COP")
    ea: Mapped[Decimal] = mapped_column(Numeric(precision=8, scale=4))           # efectiva anual %
    mv: Mapped[Decimal] = mapped_column(Numeric(precision=8, scale=4))           # mensual vencida %
    valid_from: Mapped[date] = mapped_column(Date, index=True)
    valid_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship()
