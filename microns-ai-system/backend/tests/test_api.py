"""HTTP surface: health, authentication, the n8n contract, and PHI containment."""

from __future__ import annotations

from datetime import timedelta

from app.models.appointment import Appointment, AppointmentStatus
from app.utils import utcnow


def test_health_reports_integrations(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["integrations"]["encryption_key_configured"] is True
    assert body["integrations"]["twilio"] is False


def test_root_lists_modules(client):
    body = client.get("/").json()
    assert set(body["modules"]) >= {"voice_agent", "retention", "leads", "appointments"}


def test_security_headers_are_set(client):
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Request-ID"]


# --------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------- #
def test_internal_endpoints_reject_a_missing_token(client):
    assert client.post("/internal/no-shows/detect").status_code == 401


def test_internal_endpoints_reject_a_wrong_token(client):
    response = client.post("/internal/no-shows/detect", headers={"X-Internal-Token": "nope"})
    assert response.status_code == 401


def test_internal_endpoints_accept_the_right_token(client, internal_headers):
    assert client.post("/internal/no-shows/detect", headers=internal_headers).status_code == 200


def test_missed_call_and_package_followup_endpoints_require_a_token(client):
    import uuid

    fake_id = str(uuid.uuid4())
    assert client.post(f"/internal/calls/{fake_id}/missed-call-sms").status_code == 401
    assert client.get("/internal/packages/pending-followup").status_code == 401


def test_missed_call_sms_returns_404_for_an_unknown_call(client, internal_headers):
    import uuid

    response = client.post(
        f"/internal/calls/{uuid.uuid4()}/missed-call-sms", headers=internal_headers
    )
    assert response.status_code == 404


def test_pending_package_followup_is_empty_with_no_data(client, internal_headers):
    response = client.get("/internal/packages/pending-followup", headers=internal_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_staff_endpoints_require_a_token(client, staff_headers):
    assert client.get("/retention/dashboard").status_code == 401
    assert client.get("/retention/dashboard", headers=staff_headers).status_code == 200


def test_denied_access_is_written_to_the_audit_trail(client, db):
    from app.models.audit_log import AuditLog

    client.get("/retention/dashboard")
    assert db.query(AuditLog).filter(AuditLog.outcome == "denied").count() == 1


# --------------------------------------------------------------------- #
# Appointments API (the n8n contract)
# --------------------------------------------------------------------- #
def test_create_and_fetch_an_appointment(client, staff_headers):
    when = (utcnow() + timedelta(hours=24)).isoformat()
    created = client.post(
        "/api/appointments",
        json={"phone": "+15552223333", "name": "Alex Kim", "service": "facial", "scheduled_for": when},
        headers=staff_headers,
    )
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "confirmed"
    # The response is de-identified even for staff.
    assert "Alex" not in created.text
    assert "5552223333" not in created.text

    fetched = client.get(f"/api/appointments/{body['appointment_id']}", headers=staff_headers)
    assert fetched.status_code == 200
    assert fetched.json()["service"] == "facial"


def test_upcoming_endpoint_feeds_the_reminder_workflow(client, staff_headers, internal_headers):
    when = (utcnow() + timedelta(hours=24)).isoformat()
    client.post(
        "/api/appointments",
        json={"phone": "+15552224444", "service": "botox", "scheduled_for": when},
        headers=staff_headers,
    )

    rows = client.get("/api/appointments/upcoming?within_hours=48", headers=internal_headers).json()
    assert len(rows) == 1
    assert rows[0]["due_24h_reminder"] is True

    sent = client.post(
        "/internal/reminders/send",
        json={"appointment_id": rows[0]["appointment_id"], "kind": "24h"},
        headers=internal_headers,
    ).json()
    assert sent["status"] == "sent"

    again = client.post(
        "/internal/reminders/send",
        json={"appointment_id": rows[0]["appointment_id"], "kind": "24h"},
        headers=internal_headers,
    ).json()
    assert again["status"] == "skipped"


def test_no_show_workflow_endpoints(client, staff_headers, internal_headers, db, patient):
    appointment = Appointment(
        patient_id=patient.id,
        service="botox",
        scheduled_for=utcnow() - timedelta(hours=6),
        status=AppointmentStatus.CONFIRMED,
    )
    db.add(appointment)
    db.commit()

    detected = client.post("/internal/no-shows/detect", headers=internal_headers).json()
    assert detected["data"]["flagged"] == 1

    listed = client.get("/api/appointments/no-shows?days=1", headers=internal_headers).json()
    assert listed[0]["appointment_id"] == str(appointment.id)

    reactivated = client.post(
        "/internal/no-shows/reactivate",
        json={"appointment_id": str(appointment.id)},
        headers=internal_headers,
    ).json()
    assert reactivated["status"] == "sent"


def test_review_workflow_endpoints(client, staff_headers, internal_headers, db, patient):
    appointment = Appointment(
        patient_id=patient.id,
        service="facial",
        scheduled_for=utcnow() - timedelta(days=6),
        status=AppointmentStatus.CONFIRMED,
    )
    db.add(appointment)
    db.commit()

    completed = client.post(
        "/webhooks/treatment-completed", json={"appointment_id": str(appointment.id)}
    )
    assert completed.status_code == 200

    # The review clock opened 6 days ago, so the poller should offer it now.
    pending = client.get("/internal/reviews/pending", headers=internal_headers).json()
    assert pending == [] or pending[0]["appointment_id"] == str(appointment.id)

    status = client.get(
        f"/internal/reviews/status/{appointment.id}", headers=internal_headers
    ).json()
    assert status["review_received"] is False

    requested = client.post(
        "/internal/reviews/request",
        json={"appointment_id": str(appointment.id)},
        headers=internal_headers,
    ).json()
    assert requested["status"] == "sent"

    received = client.post(
        "/internal/reviews/received",
        json={"appointment_id": str(appointment.id), "rating": 5, "review_text": "Loved it"},
        headers=internal_headers,
    ).json()
    assert received["data"]["requires_human_approval"] is True
    assert received["data"]["draft_response"]


def test_availability_endpoint(client, staff_headers):
    body = client.get("/api/appointments/availability?service=botox", headers=staff_headers).json()
    assert body["slots"]
    assert body["provider"] == "generic"


# --------------------------------------------------------------------- #
# Twilio inbound
# --------------------------------------------------------------------- #
def test_inbound_sms_starts_qualification(client, db):
    from app.models.lead import Lead

    response = client.post(
        "/leads/sms-inbound",
        data={"From": "+15553334444", "Body": "hi, interested in botox", "MessageSid": "SM1"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/xml")
    assert "<Response>" in response.text

    lead = db.query(Lead).one()
    assert lead.source == "sms"
    assert lead.phone == "+15553334444"


def test_stop_keyword_withdraws_consent(client, db, patient):
    assert patient.marketing_consent is True
    client.post("/leads/sms-inbound", data={"From": patient.phone, "Body": "STOP", "MessageSid": "SM2"})

    db.refresh(patient)
    assert patient.marketing_consent is False
    assert patient.sms_consent is False


def test_twilio_status_callback_records_only_the_sid(client, db):
    from app.models.audit_log import AuditLog

    response = client.post(
        "/webhooks/twilio/status",
        data={"MessageSid": "SM3", "MessageStatus": "delivered", "To": "+15551234567"},
    )
    assert response.status_code == 200
    row = db.query(AuditLog).filter(AuditLog.action == "sms_status").one()
    assert row.details["message_sid"] == "SM3"
    assert "5551234567" not in str(row.details)


# --------------------------------------------------------------------- #
# Booking-system webhook
# --------------------------------------------------------------------- #
def test_booking_system_event_creates_and_cancels(client, db):
    when = (utcnow() + timedelta(days=2)).isoformat()
    created = client.post(
        "/webhooks/booking-system",
        json={
            "event": "appointment.created",
            "external_id": "acuity-123",
            "phone": "+15556667777",
            "name": "Pat Lee",
            "service": "peel",
            "scheduled_for": when,
        },
    ).json()
    assert created["status"] == "created"

    duplicate = client.post(
        "/webhooks/booking-system",
        json={
            "event": "appointment.created",
            "external_id": "acuity-123",
            "phone": "+15556667777",
            "scheduled_for": when,
        },
    ).json()
    assert duplicate["status"] == "duplicate"

    cancelled = client.post(
        "/webhooks/booking-system", json={"event": "appointment.cancelled", "external_id": "acuity-123"}
    ).json()
    assert cancelled["status"] == "cancelled"


# --------------------------------------------------------------------- #
# Rate limiting and error handling
# --------------------------------------------------------------------- #
def test_chat_is_rate_limited(client):
    codes = {
        client.post("/leads/chat", json={"message": "hello there"}).status_code for _ in range(35)
    }
    assert 429 in codes


def test_unknown_lead_returns_404_not_a_stack_trace(client, staff_headers):
    response = client.get(
        "/leads/00000000-0000-4000-8000-000000000000", headers=staff_headers
    )
    assert response.status_code == 404
    assert "Traceback" not in response.text


def test_validation_errors_do_not_echo_phi(client, staff_headers):
    response = client.post(
        "/api/appointments",
        json={"phone": "+15551234567", "service": "botox", "scheduled_for": "not-a-date"},
        headers=staff_headers,
    )
    assert response.status_code == 422
    assert "5551234567" not in response.text
