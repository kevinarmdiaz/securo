import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.one_off_debt import OneOffDebt
from app.schemas.one_off_debt import OneOffDebtCreate, OneOffDebtUpdate


async def list_one_off_debts(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    target_month: Optional[date] = None,
    include_paid: bool = True,
) -> list[OneOffDebt]:
    stmt = select(OneOffDebt).where(OneOffDebt.workspace_id == workspace_id)
    if target_month is not None:
        stmt = stmt.where(OneOffDebt.target_month == target_month)
    if not include_paid:
        stmt = stmt.where(OneOffDebt.paid.is_(False))
    stmt = stmt.order_by(OneOffDebt.target_month, OneOffDebt.priority, OneOffDebt.due_date)
    return list((await session.execute(stmt)).scalars().all())


async def get_one_off_debt(
    session: AsyncSession, workspace_id: uuid.UUID, debt_id: uuid.UUID
) -> Optional[OneOffDebt]:
    stmt = select(OneOffDebt).where(
        OneOffDebt.id == debt_id, OneOffDebt.workspace_id == workspace_id
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def create_one_off_debt(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: OneOffDebtCreate,
) -> OneOffDebt:
    debt = OneOffDebt(
        user_id=user_id,
        workspace_id=workspace_id,
        **payload.model_dump(),
    )
    session.add(debt)
    await session.flush()
    await session.refresh(debt)
    return debt


async def update_one_off_debt(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    debt_id: uuid.UUID,
    payload: OneOffDebtUpdate,
) -> Optional[OneOffDebt]:
    debt = await get_one_off_debt(session, workspace_id, debt_id)
    if not debt:
        return None
    data = payload.model_dump(exclude_unset=True)
    was_unpaid = not debt.paid
    for k, v in data.items():
        setattr(debt, k, v)
    # Auto-timestamp paid_at cuando pasa de unpaid → paid
    if was_unpaid and debt.paid and debt.paid_at is None:
        debt.paid_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(debt)
    return debt


async def delete_one_off_debt(
    session: AsyncSession, workspace_id: uuid.UUID, debt_id: uuid.UUID
) -> bool:
    debt = await get_one_off_debt(session, workspace_id, debt_id)
    if not debt:
        return False
    await session.delete(debt)
    return True
