"""Retention: reminders, no-show recovery, reviews, reactivation, dashboard."""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.models.appointment import Appointment, AppointmentStatus
from app.models.patient import Patient
from app.models.retention_event import RetentionEvent, RetentionEventType
from app.services.retention_service import RetentionService
from app.utils import utcnow


@pytest.fixture
def service(db) -> RetentionService:
    return RetentionService(db)


def make_appointment(db, patient, *, hours_from_now=24.0, status=AppointmentStatus.CONFIRMED, **fields):
    appointment = Appointment(
        patient_id=patient.id,
        service=fields.pop("service", "botox"),
        scheduled_for=utcnow() + timedelta(hours=hours_from_now),
        status=status,
        duration_minutes=30,
        **fields,
    )
    db.add(appointment)
    db.commit()
    return appointment


# --------------------------------------------------------------------- #
# Reminders
# --------------------------------------------------------------------- #
def test_upcoming_payload_is_deidentified(db, service, patient):
    make_appointment(db, patient, hours_from_now=24)
    payload = service.upcoming_appointments(within_hours=48)

    assert len(payload) == 1
    row = payload[0]
    assert row["patient_uuid"] == str(patient.id)
    assert row["due_24h_reminder"] is True
    # The n8n-facing payload must carry no identifiers at all.
    assert "Jane" not in str(row)
    assert "5551234567" not in str(row)
    assert not any(key in row for key in ("name", "phone", "email"))


def test_reminder_windows(db, service, patient):
    make_appointment(db, patient, hours_from_now=24)
    make_appointment(db, patient, hours_from_now=2)
    make_appointment(db, patient, hours_from_now=70)

    payload = {round(row["hours_until"]): row for row in service.upcoming_appointments(96)}
    assert payload[24]["due_24h_reminder"] is True
    assert payload[24]["due_2h_reminder"] is False
    assert payload[2]["due_2h_reminder"] is True
    assert payload[70]["due_24h_reminder"] is False


def test_reminder_is_idempotent(db, service, patient):
    """The hourly cron will call this twice. It must text once."""
    appointment = make_appointment(db, patient, hours_from_now=24)

    first = service.send_reminder(appointment.id, kind="24h")
    second = service.send_reminder(appointment.id, kind="24h")

    assert first["status"] == "sent"
    assert second["status"] == "skipped"
    assert second["reason"] == "already_sent"

    events = db.query(RetentionEvent).filter(
        RetentionEvent.event_type == RetentionEventType.REMINDER_SENT
    ).count()
    assert events == 1


def test_reminder_skips_cancelled_appointments(db, service, patient):
    appointment = make_appointment(db, patient, status=AppointmentStatus.CANCELLED)
    result = service.send_reminder(appointment.id, kind="24h")
    assert result["status"] == "skipped"
    assert result["reason"] == "appointment_cancelled"


def test_reminder_respects_sms_consent(db, service, patient):
    patient.sms_consent = False
    db.commit()
    appointment = make_appointment(db, patient, hours_from_now=24)

    result = service.send_reminder(appointment.id, kind="24h")
    assert result["sms_status"] == "suppressed"


def test_reminder_copy_omits_treatment_by_default(db, service, patient):
    from app.services.sms_service import reminder_24h

    body = reminder_24h(service="Botox", when=utcnow() + timedelta(hours=24), first_name="Jane")
    assert "Botox" not in body, "treatment names stay off lock screens by default"
    assert "your appointment" in body


# --------------------------------------------------------------------- #
# No-show recovery
# --------------------------------------------------------------------- #
def test_detect_no_shows_flags_past_due(db, service, patient):
    stale = make_appointment(db, patient, hours_from_now=-4)
    recent = make_appointment(db, patient, hours_from_now=-1)

    flagged = service.detect_no_shows(grace_hours=2)

    db.refresh(stale)
    db.refresh(recent)
    assert [row["appointment_id"] for row in flagged] == [str(stale.id)]
    assert stale.status == AppointmentStatus.NO_SHOW
    assert recent.status == AppointmentStatus.CONFIRMED


def test_reactivation_is_idempotent_and_skips_rebooked(db, service, patient):
    missed = make_appointment(db, patient, hours_from_now=-24, status=AppointmentStatus.NO_SHOW)

    assert service.send_reactivation(missed.id)["status"] == "sent"
    assert service.send_reactivation(missed.id)["reason"] == "already_sent"

    # A patient who rebooked must not get the credit nudge.
    make_appointment(db, patient, hours_from_now=48)
    assert service.send_credit_offer(missed.id)["reason"] == "already_rebooked"


def test_credit_offer_sends_when_still_not_rebooked(db, service, patient):
    missed = make_appointment(db, patient, hours_from_now=-72, status=AppointmentStatus.NO_SHOW)
    result = service.send_credit_offer(missed.id)
    assert result["status"] == "sent"

    event = db.query(RetentionEvent).filter(
        RetentionEvent.event_type == RetentionEventType.CREDIT_OFFER_SENT
    ).one()
    assert event.event_metadata["credit_amount"] == 50


def test_reactivation_respects_marketing_consent(db, service, patient):
    patient.marketing_consent = False
    db.commit()
    missed = make_appointment(db, patient, hours_from_now=-24, status=AppointmentStatus.NO_SHOW)
    assert service.send_reactivation(missed.id)["status"] == "suppressed"


# --------------------------------------------------------------------- #
# Reviews
# --------------------------------------------------------------------- #
def test_treatment_completed_updates_history_and_opens_review_window(db, service, patient):
    appointment = make_appointment(db, patient, hours_from_now=-1)
    result = service.treatment_completed(appointment.id)

    db.refresh(appointment)
    db.refresh(patient)
    assert appointment.status == AppointmentStatus.COMPLETED
    assert patient.last_visit_at is not None
    assert patient.treatment_history[-1]["service"] == "botox"
    assert "review_due_at" in result


def test_review_request_requires_completion_and_runs_once(db, service, patient):
    appointment = make_appointment(db, patient, hours_from_now=-1)
    assert service.request_review(appointment.id)["reason"] == "appointment_confirmed"

    service.treatment_completed(appointment.id)
    assert service.request_review(appointment.id)["status"] == "sent"
    assert service.request_review(appointment.id)["reason"] == "already_requested"


def test_review_response_draft_falls_back_without_an_llm(db, service, patient):
    appointment = make_appointment(db, patient, hours_from_now=-1)
    service.treatment_completed(appointment.id)

    result = service.record_review(appointment.id, rating=5, review_text="Jane loved her results!")
    assert result["requires_human_approval"] is True
    assert result["draft_response"]
    assert "Test Med Spa" in result["draft_response"]


def test_negative_review_draft_offers_a_private_route(db, service, patient):
    draft = service.draft_review_response(review_text="Waited 40 minutes.", rating=2)
    assert "sorry" in draft.lower()
    assert "manager" in draft.lower()


# --------------------------------------------------------------------- #
# Dormant patients
# --------------------------------------------------------------------- #
def test_patients_at_risk_excludes_the_recently_seen_and_the_booked(db, service, patient):
    dormant = Patient.create(phone="+15550000001", name="Old Patient", sms_consent=True)
    dormant.last_visit_at = utcnow() - timedelta(days=90)
    booked = Patient.create(phone="+15550000002", name="Booked Patient", sms_consent=True)
    booked.last_visit_at = utcnow() - timedelta(days=90)
    db.add_all([dormant, booked])
    db.commit()
    make_appointment(db, booked, hours_from_now=48)

    at_risk = {row["patient_uuid"] for row in service.patients_at_risk(days=45)}
    assert str(dormant.id) in at_risk
    assert str(booked.id) not in at_risk, "someone with an upcoming visit is not at risk"
    assert str(patient.id) not in at_risk, "seen today"


def test_at_risk_names_are_masked(db, service):
    dormant = Patient.create(phone="+15550000003", name="Sandra Bullock", sms_consent=True)
    dormant.last_visit_at = utcnow() - timedelta(days=90)
    db.add(dormant)
    db.commit()

    row = service.patients_at_risk(days=45)[0]
    assert row["display_name"] == "Sandra B."


def test_dormant_reactivation_has_a_cooldown(db, service):
    dormant = Patient.create(
        phone="+15550000004", name="Old Patient", sms_consent=True, marketing_consent=True
    )
    dormant.last_visit_at = utcnow() - timedelta(days=90)
    db.add(dormant)
    db.commit()

    assert service.send_dormant_reactivation(dormant.id)["status"] == "sent"
    assert service.send_dormant_reactivation(dormant.id)["reason"] == "cooldown"


# --------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------- #
def test_dashboard_computes_rates(db, service, patient):
    make_appointment(db, patient, hours_from_now=-48, status=AppointmentStatus.NO_SHOW)
    make_appointment(db, patient, hours_from_now=-24, status=AppointmentStatus.COMPLETED)
    make_appointment(db, patient, hours_from_now=-12, status=AppointmentStatus.COMPLETED)
    make_appointment(db, patient, hours_from_now=-6, status=AppointmentStatus.COMPLETED)

    stats = service.dashboard(days=30)
    assert stats["appointments"]["total"] == 4
    assert stats["appointments"]["no_shows"] == 1
    assert stats["appointments"]["no_show_rate"] == 25.0
    assert stats["appointments"]["completion_rate"] == 75.0


def test_dashboard_is_aggregate_only(db, service, patient):
    make_appointment(db, patient, hours_from_now=-24, status=AppointmentStatus.COMPLETED)
    body = str(service.dashboard(days=30))
    assert "Jane" not in body
    assert "5551234567" not in body


# --------------------------------------------------------------------------- #
# The reminder is claimed before it is sent
# --------------------------------------------------------------------------- #
def test_a_crash_after_sending_does_not_text_the_patient_twice(db, service, patient, monkeypatch):
    """The marker has to be committed before the send, not after.

    Marking afterwards looks equivalent and is not: the text goes out, the
    commit fails or the process dies, and the next run finds no marker and
    sends it again. Duplicate reminders are the one failure here a patient
    actually notices, and the one with regulatory weight.
    """
    appointment = make_appointment(db, patient)

    sent = []
    real_send = service.sms.send

    def exploding_send(**kwargs):
        result = real_send(**kwargs)
        sent.append(kwargs)
        raise RuntimeError("process died after the text went out")

    monkeypatch.setattr(service.sms, "send", exploding_send)
    with pytest.raises(RuntimeError):
        service.send_reminder(appointment.id, kind="24h")

    assert len(sent) == 1

    # A fresh service, as the next scheduled run would be.
    db.rollback()
    monkeypatch.setattr(service.sms, "send", real_send)
    second = service.send_reminder(appointment.id, kind="24h")

    assert second["status"] == "skipped", second
    assert second["reason"] == "already_sent"
    assert len(sent) == 1, "the patient must not be texted a second time"


def test_a_transient_send_failure_is_retried(db, service, patient, monkeypatch):
    """A claim that never turned into a message has to be released.

    Otherwise one Twilio blip silently costs that appointment its reminder.
    """
    from app.services.sms_service import SMSResult

    appointment = make_appointment(db, patient)

    monkeypatch.setattr(
        service.sms,
        "send",
        lambda **kw: SMSResult(delivered=False, status="failed", reason="ConnectionError"),
    )
    first = service.send_reminder(appointment.id, kind="24h")
    assert first["status"] == "failed"

    db.expire_all()
    assert db.get(Appointment, appointment.id).reminder_24h_sent_at is None, (
        "a failed send must not leave the reminder marked as sent"
    )

    monkeypatch.setattr(
        service.sms,
        "send",
        lambda **kw: SMSResult(delivered=True, status="sent", message_sid="SM1"),
    )
    second = service.send_reminder(appointment.id, kind="24h")
    assert second["status"] == "sent", second


def test_a_suppressed_message_is_not_retried_forever(db, service, patient, monkeypatch):
    """No consent is a decision, not an outage.

    Re-deciding it every run is how somebody who opted out gets texted anyway
    the moment consent is misread.
    """
    from app.services.sms_service import SMSResult

    appointment = make_appointment(db, patient)
    monkeypatch.setattr(
        service.sms,
        "send",
        lambda **kw: SMSResult(delivered=False, status="suppressed", reason="no_consent"),
    )

    first = service.send_reminder(appointment.id, kind="24h")
    assert first["status"] == "suppressed", (
        "a message nobody consented to is not a failure — reporting it as one "
        "makes a clinic with no consent on file look like a broken integration"
    )
    assert first["reason"] == "no_consent"

    db.expire_all()
    assert db.get(Appointment, appointment.id).reminder_24h_sent_at is not None

    assert service.send_reminder(appointment.id, kind="24h")["status"] == "skipped"
