"""The V4 owner projections: command centre, recovery, activity feed.

These three power the screens an owner actually looks at, which makes them the
easiest place in the product to start lying. The tests below are mostly about
restraint: totals must agree with the projections they were composed from,
rates must carry their denominators, the activity feed must contain only work
that has actually happened, and an empty clinic must produce empty numbers
rather than encouraging ones.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.patient import Patient
from app.models.retention_event import RetentionEvent, RetentionEventType
from app.services import demo_service
from app.services.console_service import ConsoleService
from app.utils import utcnow


@pytest.fixture
def service(db):
    return ConsoleService(db)


@pytest.fixture
def seeded(db):
    demo_service.seed(db)
    return ConsoleService(db)


# --------------------------------------------------------------------- #
# Command centre
# --------------------------------------------------------------------- #
def test_empty_clinic_reports_zero_not_encouragement(service):
    payload = service.command_center(days=30)

    assert payload["headline"]["cents"] == 0
    assert payload["headline"]["basis"] == "none"
    assert payload["attention"] == []
    assert payload["activity"] == []
    assert all(counter["value"] == 0 for counter in payload["today"])


def test_headline_equals_the_three_influenced_buckets(seeded):
    payload = seeded.command_center(days=30)
    revenue = seeded.revenue(days=30)

    expected = sum(
        revenue["attribution"][key]["cents"]
        for key in ("ai_booked", "recovered_no_show", "reactivated")
    )
    assert payload["headline"]["cents"] == expected

    # Front-desk bookings are shown, but never inside "revenue influenced" —
    # the engine did not cause them and must not claim them.
    assert revenue["attribution"]["front_desk"]["cents"] > 0
    assert payload["headline"]["cents"] < sum(
        bucket["cents"] for bucket in revenue["attribution"].values()
    )


def test_headline_basis_names_the_kind_of_money(seeded, db):
    payload = seeded.command_center(days=30)
    # The demo prices everything from the clinic's list, so the honest label
    # is "expected" — a projection, not collected revenue.
    assert payload["headline"]["basis"] == "expected"
    assert payload["headline"]["recorded_cents"] == 0
    assert payload["headline"]["expected_cents"] == payload["headline"]["cents"]


def test_basis_becomes_mixed_once_real_money_arrives(seeded, db):
    from app.services import pricing_service

    booked = (
        db.execute(
            select(Appointment).where(
                Appointment.source.in_(
                    (AppointmentSource.VOICE, AppointmentSource.WEB, AppointmentSource.SMS)
                )
            )
        )
        .scalars()
        .first()
    )
    pricing_service.mark_recorded_price(booked, 55_000)
    db.commit()

    payload = seeded.command_center(days=90)
    assert payload["headline"]["basis"] == "mixed"
    assert payload["headline"]["recorded_cents"] == 55_000


def test_revenue_split_covers_every_appointment(seeded):
    payload = seeded.command_center(days=30)
    revenue = seeded.revenue(days=30)

    assert sum(row["count"] for row in payload["revenue_split"]) == revenue["coverage"][
        "appointments"
    ]


def test_attention_puts_clinical_callbacks_first(service, db):
    """A patient waiting on a provider outranks any commercial opportunity."""
    queue = service._attention_queue(
        [
            {"kind": "warm_lead", "urgency": 0, "waiting_hours": 200, "flags": []},
            {"kind": "callback", "urgency": 3, "waiting_hours": 1, "flags": ["clinical"]},
        ]
    )
    assert queue[0]["kind"] == "callback"


def test_attention_is_a_shortlist_but_the_total_is_reported(seeded):
    payload = seeded.command_center(days=30)
    assert len(payload["attention"]) <= 6
    assert payload["attention_total"] >= len(payload["attention"])


def test_team_status_is_passed_through_untouched(seeded):
    """The command centre must not upgrade a disconnected agent to 'working'."""
    payload = seeded.command_center(days=30)
    agents = {agent["id"]: agent for agent in seeded.agents(days=30)}

    assert payload["team"]
    for summary in payload["team"]:
        assert summary["status"] == agents[summary["id"]]["status"]

    assert {row["id"] for row in payload["team"]} == set(agents)


def test_a_disconnected_agent_is_never_shown_as_working(seeded, monkeypatch):
    """Pulling the phone credentials must be visible on the owner's home screen."""
    monkeypatch.setattr("app.config.settings.vapi_webhook_secret", None)
    monkeypatch.setattr("app.config.settings.vapi_api_key", None)

    receptionist = next(
        row for row in seeded.command_center(days=30)["team"] if row["id"] == "receptionist"
    )
    assert receptionist["status"] != "live"
    assert receptionist["status_detail"]


def test_today_counters_only_count_today(service, db, patient):
    yesterday = utcnow() - timedelta(days=1)
    stale = Appointment(
        patient_id=patient.id,
        service="botox",
        scheduled_for=utcnow(),
        status=AppointmentStatus.CONFIRMED,
        source=AppointmentSource.WEB,
    )
    db.add(stale)
    db.flush()
    stale.created_at = yesterday
    db.commit()

    counters = {row["key"]: row["value"] for row in service.command_center(days=30)["today"]}
    assert counters["booked"] == 0


# --------------------------------------------------------------------- #
# Recovery
# --------------------------------------------------------------------- #
def test_recovery_rates_carry_their_denominators(seeded):
    payload = seeded.recovery(days=90)

    missed = payload["missed"]
    assert missed["basis"] == f"{missed['recovered']} of {missed['contacted']} contacted"

    dormant = payload["dormant"]
    assert dormant["basis"] == f"{dormant['returned']} of {dormant['contacted']} contacted"


def test_recovery_rate_is_of_those_contacted_not_of_all_misses(seeded):
    payload = seeded.recovery(days=90)["missed"]
    assert payload["contacted"] < payload["total"], "some misses go uncontacted"
    assert payload["recovered"] <= payload["contacted"]

    from app.services.console_service import _rate

    assert payload["recovery_rate"] == _rate(payload["recovered"], payload["contacted"])


def test_recovery_is_not_a_perfect_score(seeded):
    """Guards against a seeder that quietly recovers everything."""
    missed = seeded.recovery(days=90)["missed"]
    assert 0 < missed["recovery_rate"] < 100


def test_empty_recovery_explains_itself_rather_than_showing_zero_percent(service):
    payload = service.recovery(days=90)
    assert payload["missed"]["recovery_rate"] == 0.0
    assert "No recovery messages sent" in payload["missed"]["basis"]
    assert "No reactivation messages sent" in payload["dormant"]["basis"]


def test_every_recovery_story_has_a_contact_behind_it(seeded):
    for story in seeded.recovery(days=90)["stories"]:
        assert story["contacted_at"] is not None
        if story["recovered"]:
            assert story["rebooked_for"] is not None


def test_recovery_stories_carry_no_patient_identifiers(seeded):
    """Masked names only, exactly as everywhere else in the console."""
    for story in seeded.recovery(days=90)["stories"]:
        assert story["subject"]
        # "Amelia W." is the console's format; a full surname is a leak.
        surname = story["subject"].split(" ")[-1]
        assert len(surname.rstrip(".")) <= 1 or story["subject"] == "Client"


def test_dormant_threshold_comes_from_configuration(seeded):
    from app.config import settings

    assert seeded.recovery(days=90)["dormant"]["threshold_days"] == settings.reactivation_days


# --------------------------------------------------------------------- #
# Activity feed
# --------------------------------------------------------------------- #
def test_activity_never_reports_work_that_has_not_happened(seeded, db, patient):
    """Reminders are written ahead of time; the log is not a schedule."""
    future = utcnow() + timedelta(days=3)
    event = RetentionEvent(
        patient_id=patient.id,
        event_type=RetentionEventType.REMINDER_SENT,
        channel="sms",
        event_metadata={},
    )
    db.add(event)
    db.flush()
    event.created_at = future
    db.commit()

    now = utcnow().isoformat()
    for item in seeded.activity(limit=100)["items"]:
        assert item["at"] <= now, f"activity feed shows a future event: {item}"


def test_activity_is_newest_first(seeded):
    stamps = [item["at"] for item in seeded.activity(limit=40)["items"]]
    assert stamps == sorted(stamps, reverse=True)


def test_activity_respects_its_limit(seeded):
    assert len(seeded.activity(limit=5)["items"]) == 5


def test_activity_is_empty_on_a_quiet_clinic(service):
    """No filler. A short list is the honest answer."""
    assert service.activity(limit=20)["items"] == []


def test_activity_rows_never_leak_a_patient_id(seeded):
    for item in seeded.activity(limit=40)["items"]:
        assert "patient_id" not in item


def test_activity_names_are_masked(seeded):
    for item in seeded.activity(limit=40)["items"]:
        if item["detail"] and "·" not in item["detail"]:
            surname = item["detail"].split(" ")[-1]
            assert len(surname.rstrip(".")) <= 1 or item["detail"] == "Client"


def test_activity_covers_every_kind_of_work(seeded):
    actors = {item["actor"] for item in seeded.activity(limit=200)["items"]}
    # The feed reads as a team log, so more than one team member must appear.
    assert len(actors) >= 3
