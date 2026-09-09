"""Appointment pricing, and the distinction the revenue console rests on.

The point of these tests is not that a number gets written. It is that the
*claim* attached to the number stays true: a figure from a booking platform
must never be relabelled as a projection, a projection must never be
presented as collected revenue, and a service the clinic has not priced must
come out as "unknown" rather than as zero.
"""

from __future__ import annotations

import json

import pytest

from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.services import pricing_service
from app.utils import utcnow


@pytest.fixture(autouse=True)
def _clear_price_cache():
    pricing_service.reset_cache()
    yield
    pricing_service.reset_cache()


def make_appointment(service: str = "botox", **kwargs) -> Appointment:
    return Appointment(
        patient_id=None,
        service=service,
        scheduled_for=utcnow(),
        status=AppointmentStatus.CONFIRMED,
        source=AppointmentSource.WEB,
        extra={},
        **kwargs,
    )


# --------------------------------------------------------------------- #
# Expected value
# --------------------------------------------------------------------- #
def test_expected_price_is_applied_and_tagged():
    appointment = make_appointment("botox")
    pricing_service.apply_expected_price(appointment)

    assert appointment.price_cents == pricing_service.DEFAULT_BOOKING_VALUES["botox"]
    assert pricing_service.price_source(appointment) == pricing_service.PRICE_SOURCE_EXPECTED


def test_unknown_service_stays_unpriced():
    """An unpriced service is 'we don't know', not 'it is worth nothing'."""
    appointment = make_appointment("cryotherapy")
    pricing_service.apply_expected_price(appointment)

    assert appointment.price_cents is None
    assert pricing_service.price_source(appointment) is None


def test_service_matching_is_case_and_space_insensitive():
    appointment = make_appointment("  Laser  ")
    pricing_service.apply_expected_price(appointment)
    assert appointment.price_cents == pricing_service.DEFAULT_BOOKING_VALUES["laser"]


def test_complimentary_consultation_is_zero_not_none():
    """Zero is a real, known price here — the clinic does not charge for it."""
    appointment = make_appointment("consultation")
    pricing_service.apply_expected_price(appointment)
    assert appointment.price_cents == 0
    assert pricing_service.price_source(appointment) == pricing_service.PRICE_SOURCE_EXPECTED


# --------------------------------------------------------------------- #
# Recorded value wins
# --------------------------------------------------------------------- #
def test_recorded_price_is_never_overwritten_by_the_price_list():
    appointment = make_appointment("botox")
    pricing_service.mark_recorded_price(appointment, 99_900)
    pricing_service.apply_expected_price(appointment)

    assert appointment.price_cents == 99_900
    assert pricing_service.price_source(appointment) == pricing_service.PRICE_SOURCE_RECORDED


def test_recorded_price_upgrades_an_expected_one():
    appointment = make_appointment("botox")
    pricing_service.apply_expected_price(appointment)
    assert pricing_service.price_source(appointment) == pricing_service.PRICE_SOURCE_EXPECTED

    pricing_service.mark_recorded_price(appointment, 51_500)
    assert appointment.price_cents == 51_500
    assert pricing_service.price_source(appointment) == pricing_service.PRICE_SOURCE_RECORDED


def test_marking_a_null_price_changes_nothing():
    appointment = make_appointment("botox")
    pricing_service.apply_expected_price(appointment)
    before = appointment.price_cents

    pricing_service.mark_recorded_price(appointment, None)
    assert appointment.price_cents == before
    assert pricing_service.price_source(appointment) == pricing_service.PRICE_SOURCE_EXPECTED


# --------------------------------------------------------------------- #
# Clinic-supplied price lists
# --------------------------------------------------------------------- #
def test_clinic_price_list_overrides_the_defaults(tmp_path, monkeypatch):
    path = tmp_path / "prices.json"
    path.write_text(json.dumps({"botox": {"label": "Botox", "booking_value": 610.50}}))
    monkeypatch.setattr("app.config.settings.service_price_list_path", str(path))
    pricing_service.reset_cache()

    assert pricing_service.expected_value_cents("botox") == 61_050
    # Services the clinic did not override keep their defaults.
    assert pricing_service.expected_value_cents("facial") == pricing_service.DEFAULT_BOOKING_VALUES["facial"]


def test_entries_without_a_booking_value_are_ignored(tmp_path, monkeypatch):
    """``from`` is a starting price, not an appointment value.

    Botox listed at "from $12 per unit" must not become a $12 appointment.
    """
    path = tmp_path / "prices.json"
    path.write_text(json.dumps({"botox": {"label": "Botox", "from": 12, "unit": "per unit"}}))
    monkeypatch.setattr("app.config.settings.service_price_list_path", str(path))
    pricing_service.reset_cache()

    assert pricing_service.expected_value_cents("botox") == pricing_service.DEFAULT_BOOKING_VALUES["botox"]


def test_a_broken_price_list_does_not_break_booking(tmp_path, monkeypatch):
    path = tmp_path / "prices.json"
    path.write_text("{ this is not json")
    monkeypatch.setattr("app.config.settings.service_price_list_path", str(path))
    pricing_service.reset_cache()

    # Falls back rather than raising — a bad config file must not take the
    # phone line down mid-call.
    assert pricing_service.expected_value_cents("botox") == pricing_service.DEFAULT_BOOKING_VALUES["botox"]


def test_a_missing_price_list_falls_back(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.settings.service_price_list_path", str(tmp_path / "nope.json"))
    pricing_service.reset_cache()
    assert pricing_service.expected_value_cents("peel") == pricing_service.DEFAULT_BOOKING_VALUES["peel"]


def test_shipped_price_list_carries_booking_values():
    """The bundled voice-agent price list is a valid clinic price list."""
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "voice-agent" / "price-list.json"
    data = json.loads(path.read_text())
    priced = {key: entry.get("booking_value") for key, entry in data.items()}
    assert priced["botox"] == 420
    assert all(value is not None for value in priced.values())
