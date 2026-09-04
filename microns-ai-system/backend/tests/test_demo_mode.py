"""The Glow Aesthetics demo clinic.

Two things are being protected here.

The first is safety: demo data must never reach a production database, must
never look like a real patient, and must be removable without touching a row
it did not write.

The second is the harder one — **internal consistency**. The whole argument
for seeding a clinic rather than hand-writing dashboard numbers is that every
figure on screen can be clicked through to a record. These tests assert that
the console's derived numbers actually fall out of the seeded rows, so the
demo cannot quietly drift into fiction as the projections change.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.lead import Lead
from app.models.patient import Patient
from app.models.retention_event import RetentionEvent, RetentionEventType
from app.models.voice_call import VoiceCall
from app.services import demo_service
from app.services.console_service import ConsoleService


@pytest.fixture
def seeded(db):
    demo_service.seed(db)
    return db


# --------------------------------------------------------------------- #
# Safety
# --------------------------------------------------------------------- #
def test_seeding_is_refused_in_production(db, monkeypatch):
    monkeypatch.setattr("app.config.settings.environment", "production")
    with pytest.raises(demo_service.DemoModeRefused):
        demo_service.seed(db)


def test_clearing_is_refused_in_production(db, monkeypatch):
    monkeypatch.setattr("app.config.settings.environment", "production")
    with pytest.raises(demo_service.DemoModeRefused):
        demo_service.clear(db)


def test_every_demo_phone_is_a_reserved_fiction_number(seeded):
    """555-0100 to 555-0199 is reserved for fiction and cannot route anywhere."""
    import re

    reserved = re.compile(r"^\+1\d{3}55501\d{2}$")
    patients = seeded.execute(select(Patient)).scalars().all()
    assert patients
    for patient in patients:
        assert reserved.match(patient.phone), f"{patient.phone} is not a reserved number"

    leads = seeded.execute(select(Lead)).scalars().all()
    assert leads
    for lead in leads:
        assert reserved.match(lead.phone), f"{lead.phone} is not a reserved number"


def test_demo_rows_are_tagged(seeded):
    appointments = seeded.execute(select(Appointment)).scalars().all()
    assert appointments
    assert all(demo_service.is_demo_row(row) for row in appointments)

    events = seeded.execute(select(RetentionEvent)).scalars().all()
    assert events
    assert all(demo_service.is_demo_row(row) for row in events)


def test_voice_calls_carry_no_transcript(seeded):
    """The engine does not retain transcripts, so the demo must not show one."""
    calls = seeded.execute(select(VoiceCall)).scalars().all()
    assert calls
    assert all(call.transcript is None for call in calls)


def test_clear_removes_only_what_it_seeded(db):
    keeper = Patient.create(phone="+15551239999", name="Real Patient", sms_consent=True)
    db.add(keeper)
    db.commit()

    demo_service.seed(db)
    assert db.execute(select(func.count(Patient.id))).scalar_one() > 1

    demo_service.clear(db)

    remaining = db.execute(select(Patient)).scalars().all()
    assert [patient.id for patient in remaining] == [keeper.id]


def test_seeding_twice_replaces_rather_than_doubles(db):
    first = demo_service.seed(db)
    second = demo_service.seed(db)
    assert first["patients"] == second["patients"]
    assert db.execute(select(func.count(Patient.id))).scalar_one() == second["patients"]


def test_seed_is_deterministic(db):
    first = demo_service.seed(db)
    second = demo_service.seed(db)
    assert first == second


# --------------------------------------------------------------------- #
# State reporting
# --------------------------------------------------------------------- #
def test_demo_state_distinguishes_configured_from_seeded(db, monkeypatch):
    monkeypatch.setattr("app.config.settings.demo_mode", True)

    state = demo_service.demo_state(db)
    assert state["active"] is True
    assert state["seeded"] is False, "demo mode on with nothing seeded is an empty demo"

    demo_service.seed(db)
    state = demo_service.demo_state(db)
    assert state["seeded"] is True
    assert state["patients"] > 0


def test_system_projection_exposes_demo_state(seeded):
    system = ConsoleService(seeded).system()
    assert system["demo"]["seeded"] is True
    assert "fictional" in system["demo"]["note"].lower()


# --------------------------------------------------------------------- #
# Internal consistency — the numbers must fall out of the rows
# --------------------------------------------------------------------- #
def test_every_revenue_bucket_has_supporting_rows(seeded):
    revenue = ConsoleService(seeded).revenue(days=90)
    attribution = revenue["attribution"]

    # The full loop must be demonstrable: each of these is a distinct part of
    # the sales story and an empty bucket kills that part of the demo.
    assert attribution["ai_booked"]["count"] > 0
    assert attribution["recovered_no_show"]["count"] > 0
    assert attribution["reactivated"]["count"] > 0
    assert attribution["front_desk"]["count"] > 0


def test_recovered_count_matches_the_underlying_appointments(seeded):
    revenue = ConsoleService(seeded).revenue(days=90)
    reported = revenue["recovered_appointments"]
    derived = (
        revenue["attribution"]["recovered_no_show"]["count"]
        + revenue["attribution"]["reactivated"]["count"]
    )
    assert reported == derived


def test_recovery_rows_are_genuinely_recoveries(seeded):
    """Every recovered appointment must have a real no-show behind it."""
    service = ConsoleService(seeded)
    recovered = [
        appointment
        for appointment in seeded.execute(select(Appointment)).scalars().all()
        if service._attribution(appointment) == "recovered_no_show"
    ]
    assert recovered

    for appointment in recovered:
        prior = (
            seeded.execute(
                select(Appointment).where(
                    Appointment.patient_id == appointment.patient_id,
                    Appointment.status == AppointmentStatus.NO_SHOW,
                    Appointment.reactivation_sent_at.is_not(None),
                )
            )
            .scalars()
            .all()
        )
        assert prior, "a recovery with no missed appointment behind it is fiction"


def test_reactivations_have_a_campaign_behind_them(seeded):
    reactivated_patients = (
        seeded.execute(select(Patient).where(Patient.reactivation_sent_at.is_not(None)))
        .scalars()
        .all()
    )
    assert reactivated_patients

    # The engine uses REACTIVATION_SENT for both no-show recovery and dormant
    # campaigns; only the dormant one omits an appointment id.
    events = seeded.execute(
        select(func.count(RetentionEvent.id)).where(
            RetentionEvent.event_type == RetentionEventType.REACTIVATION_SENT,
            RetentionEvent.appointment_id.is_(None),
        )
    ).scalar_one()
    assert events == len(reactivated_patients)


def test_not_every_recovery_attempt_succeeds(seeded):
    """A demo where everything works is a demo nobody believes."""
    no_shows = (
        seeded.execute(
            select(Appointment).where(Appointment.status == AppointmentStatus.NO_SHOW)
        )
        .scalars()
        .all()
    )
    unrecovered = [row for row in no_shows if row.reactivation_sent_at is None]
    assert unrecovered, "some no-shows must remain open"

    contacted = (
        seeded.execute(select(Patient).where(Patient.reactivation_sent_at.is_not(None)))
        .scalars()
        .all()
    )
    booked_back = [
        patient
        for patient in contacted
        if any(
            appointment.created_at >= patient.reactivation_sent_at
            and appointment.source in (AppointmentSource.VOICE, AppointmentSource.WEB, AppointmentSource.SMS)
            for appointment in patient.appointments
        )
    ]
    assert 0 < len(booked_back) < len(contacted), "reactivation must show a real, partial rate"


def test_lead_scores_come_from_the_real_engine(seeded):
    """Scores are computed, not seeded — the demo demonstrates the product."""
    leads = seeded.execute(select(Lead).where(Lead.qualification_score > 0)).scalars().all()
    assert leads

    from app.services.lead_service import LeadService

    service = LeadService(seeded)
    for lead in leads[:12]:
        score, _breakdown, temperature = service.score_lead(lead)
        assert lead.qualification_score == score
        assert lead.temperature == temperature


def test_the_funnel_never_reports_more_bookings_than_appointments(seeded):
    funnel = {row["stage"]: row["value"] for row in ConsoleService(seeded).revenue(days=90)["funnel"]}
    assert funnel["Qualified"] <= funnel["Leads captured"]
    assert funnel["Booked"] <= funnel["Qualified"]
    assert funnel["Showed"] <= funnel["Appointments created"]


def test_appointments_are_priced_but_never_as_collected_revenue(seeded):
    """Demo money is the clinic's list value, and says so."""
    revenue = ConsoleService(seeded).revenue(days=90)
    coverage = revenue["coverage"]

    assert coverage["priced_from_price_list"] > 0
    assert coverage["priced_from_booking_system"] == 0
    for bucket in revenue["attribution"].values():
        assert bucket["recorded_cents"] == 0
        assert bucket["cents"] == bucket["expected_cents"]


def test_complimentary_consultations_are_counted_separately(seeded):
    """Free consultations must not drag the treatment value to zero."""
    bucket = ConsoleService(seeded).revenue(days=90)["attribution"]["ai_booked"]
    assert bucket["complimentary_count"] > 0
    assert bucket["count"] > bucket["complimentary_count"]
    assert bucket["cents"] > 0


def test_trends_have_a_comparable_previous_period(seeded):
    """The demo spans enough history to show movement, not 'no baseline'."""
    trend = ConsoleService(seeded).overview(days=30)["trend"]
    assert trend["leads"]["comparable"] is True
    assert trend["appointments"]["comparable"] is True


def test_the_day_is_not_absurdly_overbooked(seeded):
    """Guards the seeding artefact where every auto-booking landed today."""
    today = ConsoleService(seeded).overview(days=30)["bookings"]["today"]
    assert today <= 6, f"{today} appointments in one demo day reads as broken"
