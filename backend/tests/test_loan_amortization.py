"""
Amortizacion dinamica: los pagos reales mandan sobre la proyeccion teorica.

Los numeros vienen del extracto de Avancop del credito de compra de cartera
(producto 1745784, corte 01/03/2026 - 07/09/2026), que reporta:
  saldo anterior 91,329,642 | total abonos 17,424,709 | saldo actual 79,013,322
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.services.loan_service import _compute_amortization


class FakeLoan:
    def __init__(self, monthly_payment="2350674", insurance="65000"):
        self.id = uuid.uuid4()
        self.name = "Compra de cartera (Armando)"
        self.entity = "Avancoop"
        self.currency = "COP"
        self.monthly_rate = Decimal("1.16")
        self.monthly_payment = Decimal(monthly_payment)
        self.insurance_amount = Decimal(insurance)
        self.original_balance = Decimal("91329642")
        self.current_balance = Decimal("79013322")
        self.start_date = date(2026, 3, 1)
        self.status = "active"


class FakePayment:
    def __init__(self, day, amount, principal, interest, insurance, balance_after,
                 kind="installment", note=None):
        self.payment_date = date.fromisoformat(day)
        self.amount = Decimal(str(amount))
        self.principal = Decimal(str(principal))
        self.interest = Decimal(str(interest))
        self.insurance = Decimal(str(insurance))
        self.balance_after = Decimal(str(balance_after))
        self.kind = kind
        self.note = note


@pytest.fixture
def extracto():
    """Movimientos tal como los reporta Avancop."""
    return [
        FakePayment("2026-04-06", 2146000, 1679901, 422230, 43869, 89649741),
        FakePayment("2026-04-10", 626571, 626571, 0, 0, 89023170),
        FakePayment("2026-04-10", 685177, 685177, 0, 0, 88337993, "extra_principal"),
        FakePayment("2026-04-30", 3500000, 2413914, 1015416, 70670, 85924079),
        FakePayment("2026-04-30", 1042979, 1042979, 0, 0, 84881100, "extra_principal"),
        FakePayment("2026-05-21", 2350674, 1307682, 975087, 67905, 83573418),
        FakePayment("2026-06-09", 1053671, 549330, 504341, 0, 83024088),
        FakePayment("2026-06-09", 1297003, 270608, 959976, 66419, 82753480),
        FakePayment("2026-07-14", 2135059, 2135059, 0, 0, 80618421),
        FakePayment("2026-07-14", 236901, 0, 172406, 64495, 80618421),
        FakePayment("2026-08-12", 2350674, 1605099, 745575, 0, 79013322),
    ]


def test_sin_pagos_proyecta_desde_current_balance():
    table = _compute_amortization(FakeLoan(), [])
    assert table.actual_rows == []
    assert table.starting_balance == Decimal("79013322")
    assert table.rows[0].payment_date == date(2026, 3, 1)
    assert table.plan_vs_actual is None


def test_saldo_efectivo_sale_del_ultimo_balance_reportado(extracto):
    table = _compute_amortization(FakeLoan(), extracto)
    assert table.starting_balance == Decimal("79013322")


def test_historico_y_proyeccion_quedan_separados(extracto):
    table = _compute_amortization(FakeLoan(), extracto)
    assert len(table.actual_rows) == 11
    assert all(r.is_actual for r in table.actual_rows)
    assert all(not r.is_actual for r in table.rows)


def test_proyeccion_arranca_del_saldo_real_y_amortiza_a_cero(extracto):
    table = _compute_amortization(FakeLoan(), extracto)
    assert table.rows[0].opening_balance == Decimal("79013322")
    assert table.rows[0].payment_date == date(2026, 9, 12)
    assert table.rows[-1].closing_balance == Decimal("0")


def test_totales_pagados_cuadran_con_el_extracto(extracto):
    pv = _compute_amortization(FakeLoan(), extracto).plan_vs_actual
    assert pv.total_paid == Decimal("17424709")
    # 91,329,642 - 79,013,322
    assert pv.total_principal_paid == Decimal("12316320")
    assert pv.total_interest_paid == Decimal("4795031")
    assert pv.total_insurance_paid == Decimal("313358")


def test_el_seguro_sale_de_la_cuota_antes_del_capital(extracto):
    """Sin modelar el seguro, Securo cuenta como capital plata que nunca lo abono."""
    con_seguro = _compute_amortization(FakeLoan(insurance="65000"), extracto)
    sin_seguro = _compute_amortization(FakeLoan(insurance="0"), extracto)
    assert con_seguro.periods > sin_seguro.periods
    assert con_seguro.rows[0].principal < sin_seguro.rows[0].principal


def test_un_mes_bueno_no_tapa_los_meses_cortos(extracto):
    """
    Abril entro con 8,000,727 y mayo-agosto con ~2,350,674. Contra una cuota
    pactada de 3,321,140 el agregado da superavit, pero cuatro meses quedaron
    cortos: el mes a mes tiene que delatarlo.
    """
    pv = _compute_amortization(FakeLoan(monthly_payment="3321140"), extracto).plan_vs_actual

    assert pv.payment_gap < 0  # el agregado parece sano
    assert pv.on_track is False  # el mes a mes dice otra cosa
    assert pv.months_short == 4
    assert pv.consecutive_months_short == 4
    assert [m.month for m in pv.monthly if not m.covered] == [
        "2026-05", "2026-06", "2026-07", "2026-08",
    ]
    assert pv.total_shortfall == Decimal("3860578")


def test_meses_sin_ningun_pago_cuentan_como_cortos():
    pagos = [
        FakePayment("2026-04-30", 2350674, 1605099, 745575, 0, 89724543),
        FakePayment("2026-07-31", 2350674, 1605099, 745575, 0, 88119444),
    ]
    pv = _compute_amortization(FakeLoan(), pagos).plan_vs_actual
    # abril pago, mayo y junio nada, julio pago
    assert [m.month for m in pv.monthly] == ["2026-04", "2026-05", "2026-06", "2026-07"]
    assert pv.months_short == 2
    assert [m.month for m in pv.monthly if not m.covered] == ["2026-05", "2026-06"]
