import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.workspace_context import (
    WorkspaceContext,
    current_workspace,
    current_writable_workspace,
)
from app.schemas.one_off_debt import (
    OneOffDebtCreate,
    OneOffDebtRead,
    OneOffDebtUpdate,
)
from app.services import one_off_debt_service

router = APIRouter(prefix="/api/one-off-debts", tags=["one-off-debts"])


@router.get("", response_model=list[OneOffDebtRead])
async def list_debts(
    target_month: Optional[date] = Query(None),
    include_paid: bool = Query(True),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    return await one_off_debt_service.list_one_off_debts(
        session, ctx.workspace.id, target_month=target_month, include_paid=include_paid
    )


@router.post("", response_model=OneOffDebtRead, status_code=status.HTTP_201_CREATED)
async def create_debt(
    data: OneOffDebtCreate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    return await one_off_debt_service.create_one_off_debt(
        session, ctx.workspace.id, ctx.user_id, data
    )


@router.get("/{debt_id}", response_model=OneOffDebtRead)
async def get_debt(
    debt_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    debt = await one_off_debt_service.get_one_off_debt(session, ctx.workspace.id, debt_id)
    if not debt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debt not found")
    return debt


@router.patch("/{debt_id}", response_model=OneOffDebtRead)
async def update_debt(
    debt_id: uuid.UUID,
    data: OneOffDebtUpdate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    debt = await one_off_debt_service.update_one_off_debt(
        session, ctx.workspace.id, debt_id, data
    )
    if not debt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debt not found")
    return debt


@router.delete("/{debt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_debt(
    debt_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    ok = await one_off_debt_service.delete_one_off_debt(session, ctx.workspace.id, debt_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debt not found")
    return None
