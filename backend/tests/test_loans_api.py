"""
Tests de API de creditos y pagos.

Cubren el ciclo completo contra una sesion async real: los tests unitarios de
_compute_amortization validan la aritmetica, pero no detectan que un commit
expire los atributos y que leer una columna despues dispare IO fuera del
contexto async (MissingGreenlet).
"""

import pytest
from httpx import AsyncClient


@pytest.fixture
def loan_payload():
    return {
        "name": "Compra de cartera (Armando)",
        "entity": "Avancoop",
        "current_balance": "79013322",
        "original_balance": "91329642",
        "monthly_rate": "1.16",
        "monthly_payment": "4500000",
        "insurance_amount": "65000",
        "start_date": "2026-03-01",
        "currency": "COP",
    }


@pytest.fixture
def payment_payload():
    return {
        "payment_date": "2026-08-12",
        "amount": "2350674",
        "principal": "1605099",
        "interest": "745575",
        "insurance": "0",
        "balance_after": "79013322",
        "kind": "installment",
        "note": "Abono cuota #8",
    }


async def _create_loan(client, auth_headers, payload):
    r = await client.post("/api/loans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_create_loan_returns_enriched_fields(client: AsyncClient, auth_headers, loan_payload):
    loan = await _create_loan(client, auth_headers, loan_payload)
    assert loan["insurance_amount"] == "65000.00"
    assert loan["payments_count"] == 0
    assert float(loan["effective_balance"]) == 79013322.0
    assert loan["total_remaining_payments"] > 0


@pytest.mark.asyncio
async def test_update_loan_does_not_explode_after_commit(
    client: AsyncClient, auth_headers, loan_payload
):
    """Regresion: commit() expira los atributos y serializar la respuesta
    disparaba MissingGreenlet."""
    loan = await _create_loan(client, auth_headers, loan_payload)
    r = await client.patch(
        f"/api/loans/{loan['id']}",
        json={"current_balance": "75000000", "insurance_amount": "70000"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert float(r.json()["effective_balance"]) == 75000000.0


@pytest.mark.asyncio
async def test_add_payment_updates_balance_and_serializes(
    client: AsyncClient, auth_headers, loan_payload, payment_payload
):
    """Regresion: _sync_current_balance commitea y expiraba el pago que se
    devuelve, rompiendo la serializacion."""
    loan = await _create_loan(client, auth_headers, loan_payload)

    r = await client.post(
        f"/api/loans/{loan['id']}/payments", json=payment_payload, headers=auth_headers
    )
    assert r.status_code == 201, r.text
    assert r.json()["note"] == "Abono cuota #8"

    r = await client.get(f"/api/loans/{loan['id']}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["payments_count"] == 1
    # balance_after de la entidad manda sobre el calculado
    assert float(r.json()["effective_balance"]) == 79013322.0


@pytest.mark.asyncio
async def test_amortization_separates_actual_from_projection(
    client: AsyncClient, auth_headers, loan_payload, payment_payload
):
    loan = await _create_loan(client, auth_headers, loan_payload)
    await client.post(
        f"/api/loans/{loan['id']}/payments", json=payment_payload, headers=auth_headers
    )

    r = await client.get(f"/api/loans/{loan['id']}/amortization", headers=auth_headers)
    assert r.status_code == 200, r.text
    table = r.json()
    assert len(table["actual_rows"]) == 1
    assert table["actual_rows"][0]["is_actual"] is True
    assert all(not row["is_actual"] for row in table["rows"])
    assert table["plan_vs_actual"]["payments_recorded"] == 1


@pytest.mark.asyncio
async def test_update_and_delete_payment_resync_balance(
    client: AsyncClient, auth_headers, loan_payload, payment_payload
):
    loan = await _create_loan(client, auth_headers, loan_payload)
    r = await client.post(
        f"/api/loans/{loan['id']}/payments", json=payment_payload, headers=auth_headers
    )
    payment_id = r.json()["id"]

    r = await client.patch(
        f"/api/loans/{loan['id']}/payments/{payment_id}",
        json={"balance_after": "78000000"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    r = await client.get(f"/api/loans/{loan['id']}", headers=auth_headers)
    assert float(r.json()["effective_balance"]) == 78000000.0

    r = await client.delete(
        f"/api/loans/{loan['id']}/payments/{payment_id}", headers=auth_headers
    )
    assert r.status_code == 204

    r = await client.get(f"/api/loans/{loan['id']}", headers=auth_headers)
    assert r.json()["payments_count"] == 0
