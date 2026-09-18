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
from app.schemas.loan import (
    AmortizationTable,
    LoanCreate,
    LoanPaymentCreate,
    LoanPaymentRead,
    LoanPaymentUpdate,
    LoanRead,
    LoanUpdate,
)
from app.services import loan_service

router = APIRouter(prefix="/api/loans", tags=["loans"])


@router.get("", response_model=list[LoanRead])
async def list_loans(
    status: Optional[str] = Query(None),
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    return await loan_service.get_loans(session, ctx.workspace.id, ctx.user_id, status)


@router.post("", response_model=LoanRead, status_code=status.HTTP_201_CREATED)
async def create_loan(
    data: LoanCreate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    try:
        return await loan_service.create_loan(session, ctx.workspace.id, ctx.user_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/{loan_id}", response_model=LoanRead)
async def get_loan(
    loan_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    loan = await loan_service.get_loan(session, loan_id, ctx.workspace.id, ctx.user_id)
    if not loan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    return loan_service._enrich_loan_read(loan, list(loan.payments))


@router.patch("/{loan_id}", response_model=LoanRead)
async def update_loan(
    loan_id: uuid.UUID,
    data: LoanUpdate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    try:
        result = await loan_service.update_loan(session, loan_id, ctx.workspace.id, ctx.user_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    return result


@router.delete("/{loan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_loan(
    loan_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    deleted = await loan_service.delete_loan(session, loan_id, ctx.workspace.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")


@router.get("/{loan_id}/amortization", response_model=AmortizationTable)
async def get_amortization(
    loan_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    table = await loan_service.get_amortization_table(session, loan_id, ctx.workspace.id, ctx.user_id)
    if not table:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    return table


@router.get("/{loan_id}/payments", response_model=list[LoanPaymentRead])
async def list_payments(
    loan_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    payments = await loan_service.list_payments(session, loan_id, ctx.workspace.id, ctx.user_id)
    if payments is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    return payments


@router.post(
    "/{loan_id}/payments", response_model=LoanPaymentRead, status_code=status.HTTP_201_CREATED
)
async def add_payment(
    loan_id: uuid.UUID,
    data: LoanPaymentCreate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    try:
        payment = await loan_service.add_payment(
            session, loan_id, ctx.workspace.id, ctx.user_id, data
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if not payment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    return payment


@router.patch("/{loan_id}/payments/{payment_id}", response_model=LoanPaymentRead)
async def update_payment(
    loan_id: uuid.UUID,
    payment_id: uuid.UUID,
    data: LoanPaymentUpdate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    try:
        payment = await loan_service.update_payment(
            session, loan_id, payment_id, ctx.workspace.id, ctx.user_id, data
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if not payment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    return payment


@router.delete("/{loan_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_payment(
    loan_id: uuid.UUID,
    payment_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    deleted = await loan_service.delete_payment(
        session, loan_id, payment_id, ctx.workspace.id, ctx.user_id
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
