"""add interest_rate_history table

Revision ID: 074
Revises: 073
Create Date: 2026-08-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "074"
down_revision: Union[str, None] = "073"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "interest_rate_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("entity", sa.String(255), nullable=False, index=True),
        sa.Column("product_name", sa.String(255), nullable=False, index=True),
        sa.Column("rate_type", sa.String(50), nullable=False, index=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="COP"),
        sa.Column("ea", sa.Numeric(precision=8, scale=4), nullable=False),
        sa.Column("mv", sa.Numeric(precision=8, scale=4), nullable=False),
        sa.Column("valid_from", sa.Date, nullable=False, index=True),
        sa.Column("valid_to", sa.Date, nullable=True),
        sa.Column("source_url", sa.String(1000), nullable=True),
        sa.Column("notes", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint(
            "workspace_id", "entity", "product_name", "rate_type", "valid_from",
            name="uq_rate_period",
        ),
    )


def downgrade() -> None:
    op.drop_table("interest_rate_history")
