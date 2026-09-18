"""add loan_payments for dynamic amortization + insurance on loans

Revision ID: 076
Revises: 075
Create Date: 2026-09-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "076"
down_revision: Union[str, None] = "075"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "loans",
        sa.Column(
            "insurance_amount",
            sa.Numeric(precision=15, scale=2),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "loans",
        sa.Column("original_balance", sa.Numeric(precision=15, scale=2), nullable=True),
    )

    op.create_table(
        "loan_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "loan_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loans.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("payment_date", sa.Date, nullable=False),
        sa.Column("amount", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column("principal", sa.Numeric(precision=15, scale=2), nullable=False, server_default="0"),
        sa.Column("interest", sa.Numeric(precision=15, scale=2), nullable=False, server_default="0"),
        sa.Column("insurance", sa.Numeric(precision=15, scale=2), nullable=False, server_default="0"),
        # Saldo reportado por la entidad tras aplicar el pago. Manda sobre el calculado.
        sa.Column("balance_after", sa.Numeric(precision=15, scale=2), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False, server_default="installment"),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
    )
    op.create_index(
        "ix_loan_payments_loan_date", "loan_payments", ["loan_id", "payment_date"]
    )


def downgrade() -> None:
    op.drop_index("ix_loan_payments_loan_date", table_name="loan_payments")
    op.drop_table("loan_payments")
    op.drop_column("loans", "original_balance")
    op.drop_column("loans", "insurance_amount")
