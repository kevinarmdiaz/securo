import uuid
from typing import Optional

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interest_rate import InterestRateHistory
from app.schemas.interest_rate import InterestRateCreate, InterestRateRead, InterestRateUpdate


async def list_rates(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    entity: Optional[str] = None,
    product_name: Optional[str] = None,
    rate_type: Optional[str] = None,
) -> list[InterestRateRead]:
    q = select(InterestRateHistory).where(
        InterestRateHistory.workspace_id == workspace_id,
        InterestRateHistory.user_id == user_id,
    )
    if entity:
        q = q.where(InterestRateHistory.entity == entity)
    if product_name:
        q = q.where(InterestRateHistory.product_name == product_name)
    if rate_type:
        q = q.where(InterestRateHistory.rate_type == rate_type)
    q = q.order_by(desc(InterestRateHistory.valid_from))
    result = await session.execute(q)
    return [InterestRateRead.model_validate(r) for r in result.scalars().all()]


async def get_latest_rate(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    entity: str,
    product_name: str,
    rate_type: str,
) -> Optional[InterestRateRead]:
    result = await session.execute(
        select(InterestRateHistory)
        .where(
            InterestRateHistory.workspace_id == workspace_id,
            InterestRateHistory.user_id == user_id,
            InterestRateHistory.entity == entity,
            InterestRateHistory.product_name == product_name,
            InterestRateHistory.rate_type == rate_type,
        )
        .order_by(desc(InterestRateHistory.valid_from))
        .limit(1)
    )
    rate = result.scalar_one_or_none()
    return InterestRateRead.model_validate(rate) if rate else None


async def get_rate(
    session: AsyncSession,
    rate_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Optional[InterestRateHistory]:
    result = await session.execute(
        select(InterestRateHistory).where(
            InterestRateHistory.id == rate_id,
            InterestRateHistory.workspace_id == workspace_id,
            InterestRateHistory.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def create_rate(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    data: InterestRateCreate,
) -> InterestRateRead:
    rate = InterestRateHistory(
        workspace_id=workspace_id,
        user_id=user_id,
        **data.model_dump(),
    )
    session.add(rate)
    await session.commit()
    await session.refresh(rate)
    return InterestRateRead.model_validate(rate)


async def update_rate(
    session: AsyncSession,
    rate_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    data: InterestRateUpdate,
) -> Optional[InterestRateRead]:
    rate = await get_rate(session, rate_id, workspace_id, user_id)
    if not rate:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(rate, field, value)
    await session.commit()
    await session.refresh(rate)
    return InterestRateRead.model_validate(rate)


async def delete_rate(
    session: AsyncSession,
    rate_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> bool:
    result = await session.execute(
        select(InterestRateHistory).where(
            InterestRateHistory.id == rate_id,
            InterestRateHistory.workspace_id == workspace_id,
        )
    )
    rate = result.scalar_one_or_none()
    if not rate:
        return False
    await session.delete(rate)
    await session.commit()
    return True
