import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.workspace_context import (
    WorkspaceContext,
    current_workspace,
    current_writable_workspace,
)
from app.schemas.interest_rate import (
    InterestRateCreate,
    InterestRateRead,
    InterestRateUpdate,
)
from app.services import interest_rate_service

router = APIRouter(prefix="/api/interest-rates", tags=["interest-rates"])


@router.get("", response_model=list[InterestRateRead])
async def list_rates(
    entity: Optional[str] = Query(None),
    product_name: Optional[str] = Query(None),
    rate_type: Optional[str] = Query(None),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    return await interest_rate_service.list_rates(
        session, ctx.workspace.id, ctx.user_id, entity, product_name, rate_type
    )


@router.get("/latest", response_model=InterestRateRead)
async def get_latest(
    entity: str = Query(...),
    product_name: str = Query(...),
    rate_type: str = Query(...),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    rate = await interest_rate_service.get_latest_rate(
        session, ctx.workspace.id, ctx.user_id, entity, product_name, rate_type
    )
    if not rate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No hay tasas registradas")
    return rate


@router.post("", response_model=InterestRateRead, status_code=status.HTTP_201_CREATED)
async def create_rate(
    data: InterestRateCreate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    try:
        return await interest_rate_service.create_rate(session, ctx.workspace.id, ctx.user_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/{rate_id}", response_model=InterestRateRead)
async def update_rate(
    rate_id: uuid.UUID,
    data: InterestRateUpdate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    result = await interest_rate_service.update_rate(session, rate_id, ctx.workspace.id, ctx.user_id, data)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tasa no encontrada")
    return result


@router.delete("/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rate(
    rate_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    deleted = await interest_rate_service.delete_rate(session, rate_id, ctx.workspace.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tasa no encontrada")
