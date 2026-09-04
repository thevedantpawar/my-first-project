"""The Google Calendar booking adapter.

Most of these tests are about what the adapter does when Google is *not*
there, because that is the state a clinic spends its first week in and the
state a network blip puts it back into. The rules: never claim a connection
that does not exist, never take the phone line down because a calendar API is
slow, and never write anything to a shared calendar that a passer-by should
not read.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.services.booking_service import (
    GoogleCalendarBookingAdapter,
    InternalBookingAdapter,
    get_booking_service,
    _first_name_only,
)
from app.services.console_service import _booking_integration
from app.utils import utcnow


@pytest.fixture
def adapter(db):
    return GoogleCalendarBookingAdapter(db)


@pytest.fixture
def credentials(monkeypatch):
    for name, value in (
        ("google_oauth_client_id", "client-id"),
        ("google_oauth_client_secret", "client-secret"),
        ("google_oauth_refresh_token", "refresh-token"),
        ("google_calendar_id", "clinic@example.com"),
    ):
        monkeypatch.setattr(f"app.config.settings.{name}", value)


# --------------------------------------------------------------------- #
# Selection and configuration
# --------------------------------------------------------------------- #
@pytest.mark.parametrize("kind", ["google", "google_calendar"])
def test_booking_system_type_selects_the_adapter(db, monkeypatch, kind):
    monkeypatch.setattr("app.config.settings.booking_system_type", kind)
    assert isinstance(get_booking_service(db), GoogleCalendarBookingAdapter)


def test_two_of_three_oauth_values_is_not_connected(monkeypatch, adapter):
    monkeypatch.setattr("app.config.settings.google_oauth_client_id", "client-id")
    monkeypatch.setattr("app.config.settings.google_oauth_client_secret", "secret")
    monkeypatch.setattr("app.config.settings.google_oauth_refresh_token", None)

    from app.config import settings

    assert settings.google_calendar_enabled is False
    assert adapter.configured is False


def test_all_three_values_is_connected(credentials, adapter):
    from app.config import settings

    assert settings.google_calendar_enabled is True
    assert adapter.configured is True


def test_calendar_id_defaults_to_primary(adapter, monkeypatch):
    monkeypatch.setattr("app.config.settings.google_calendar_id", None)
    assert adapter._calendar_id == "primary"


# --------------------------------------------------------------------- #
# What the console says about it
# --------------------------------------------------------------------- #
def test_console_reports_google_as_not_connected_without_credentials(monkeypatch):
    monkeypatch.setattr("app.config.settings.booking_system_type", "google")
    monkeypatch.setattr("app.config.settings.google_oauth_client_id", None)
    monkeypatch.setattr("app.config.settings.google_oauth_client_secret", None)
    monkeypatch.setattr("app.config.settings.google_oauth_refresh_token", None)

    row = _booking_integration()
    assert row["provider"] == "Google Calendar"
    assert row["connected"] is False
    assert "client ID" in row["detail"]
    assert "refresh token" in row["detail"]


def test_console_never_prints_a_credential(monkeypatch):
    monkeypatch.setattr("app.config.settings.booking_system_type", "google")
    monkeypatch.setattr("app.config.settings.google_oauth_client_id", "SECRET-CLIENT-ID")
    monkeypatch.setattr("app.config.settings.google_oauth_client_secret", "SECRET-VALUE")
    monkeypatch.setattr("app.config.settings.google_oauth_refresh_token", "SECRET-REFRESH")
    monkeypatch.setattr("app.config.settings.google_calendar_id", "clinic@example.com")

    row = _booking_integration()
    assert row["connected"] is True
    blob = repr(row)
    for secret in ("SECRET-CLIENT-ID", "SECRET-VALUE", "SECRET-REFRESH"):
        assert secret not in blob


def test_the_built_in_scheduler_is_reported_as_not_connected(monkeypatch):
    monkeypatch.setattr("app.config.settings.booking_system_type", "generic")
    row = _booking_integration()
    assert row["connected"] is False
    assert "built-in" in row["detail"].lower()


def test_a_vendor_selected_without_a_key_says_so(monkeypatch):
    monkeypatch.setattr("app.config.settings.booking_system_type", "acuity")
    monkeypatch.setattr("app.config.settings.booking_api_key", None)
    row = _booking_integration()
    assert row["connected"] is False
    assert "no API key" in row["detail"]


# --------------------------------------------------------------------- #
# Degradation — the state a clinic actually spends time in
# --------------------------------------------------------------------- #
def test_unconfigured_availability_falls_back_to_the_internal_scheduler(adapter, db):
    slots = adapter.get_available_slots(service="botox", days_ahead=7, limit=5)
    internal = InternalBookingAdapter(db).get_available_slots(
        service="botox", days_ahead=7, limit=5
    )
    assert [slot.start for slot in slots] == [slot.start for slot in internal]


def test_unconfigured_booking_still_returns_a_usable_reference(adapter):
    """The appointment row is written by the caller either way."""
    reference = adapter.create_booking(
        service="botox",
        start=utcnow() + timedelta(days=1),
        patient_name="Ava Thompson",
        patient_phone="+12125550100",
    )
    assert reference.confirmed is True
    assert reference.external_id is None


def test_a_failed_token_exchange_does_not_raise(adapter, credentials, monkeypatch):
    """A calendar outage must not take the phone line down."""
    def boom(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr("app.services.booking_service.httpx.post", boom)

    assert adapter._token() is None
    slots = adapter.get_available_slots(service="botox", days_ahead=7, limit=3)
    assert slots, "must still offer the clinic's own hours"


def test_freebusy_failure_offers_internal_slots_rather_than_none(adapter, credentials, monkeypatch):
    """No times to offer is a worse failure than a visible double booking."""
    monkeypatch.setattr(adapter, "_token", lambda: "access-token")
    monkeypatch.setattr(adapter, "_busy_windows", lambda token, days: None)

    slots = adapter.get_available_slots(service="botox", days_ahead=7, limit=4)
    assert len(slots) == 4


def test_busy_windows_remove_slots(adapter, credentials, monkeypatch):
    monkeypatch.setattr(adapter, "_token", lambda: "access-token")

    baseline = adapter._fallback.get_available_slots(service="botox", days_ahead=7, limit=12)
    assert len(baseline) >= 3
    blocked = baseline[0]

    monkeypatch.setattr(
        adapter, "_busy_windows", lambda token, days: [(blocked.start, blocked.end)]
    )
    offered = adapter.get_available_slots(service="botox", days_ahead=7, limit=12)

    assert blocked.start not in [slot.start for slot in offered]
    assert offered, "the rest of the day is still bookable"


def test_cancelling_without_credentials_reports_failure_rather_than_success(adapter):
    assert adapter.cancel_booking("event-123") is False


def test_rescheduling_without_credentials_is_not_confirmed(adapter):
    reference = adapter.reschedule_booking("event-123", utcnow() + timedelta(days=2))
    assert reference.confirmed is False


# --------------------------------------------------------------------- #
# What lands on a shared calendar
# --------------------------------------------------------------------- #
def test_only_a_first_name_reaches_the_calendar_title():
    """A practice calendar is glanceable by whoever it is shared with."""
    assert _first_name_only("Ava Thompson") == "Ava"
    assert _first_name_only("Ava") == "Ava"
    assert _first_name_only(None) is None
    assert _first_name_only("  Priya  Raman ") == "Priya"


def test_the_event_body_carries_no_clinical_detail(adapter, credentials, monkeypatch):
    captured = {}

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"id": "evt-1", "htmlLink": "https://calendar.google.com/evt-1"}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["json"] = kwargs.get("json")
        return Response()

    monkeypatch.setattr(adapter, "_token", lambda: "access-token")
    monkeypatch.setattr("app.services.booking_service.httpx.post", fake_post)

    reference = adapter.create_booking(
        service="botox",
        start=utcnow() + timedelta(days=1),
        patient_name="Ava Thompson",
        patient_phone="+12125550100",
        patient_email="ava@example.com",
    )

    assert reference.external_id == "evt-1"
    body = captured["json"]
    blob = repr(body)

    # A surname and an email address on a shared calendar are disclosures.
    assert "Thompson" not in blob
    assert "ava@example.com" not in blob
    assert body["summary"].startswith("Ava")
    # Staff need to be able to call the person back.
    assert "+12125550100" in body["description"]
