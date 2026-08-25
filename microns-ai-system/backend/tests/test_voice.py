"""Voice agent: VAPI webhooks, booking, escalation, transcript handling."""

from __future__ import annotations

import pytest

from app.models.appointment import Appointment, AppointmentStatus
from app.models.voice_call import VoiceCall, VoiceCallOutcome
from app.services.voice_service import VoiceService, extract_action


@pytest.fixture
def service(db) -> VoiceService:
    return VoiceService(db)


def inbound_payload(call_id="call_test_1", number="+15551234567"):
    return {
        "message": {
            "type": "assistant-request",
            "call": {"id": call_id, "type": "inboundPhoneCall", "customer": {"number": number}},
        }
    }


def tool_payload(name, arguments, call_id="call_test_1"):
    import json

    return {
        "message": {
            "type": "tool-calls",
            "call": {"id": call_id},
            "toolCalls": [{"id": "tc_1", "function": {"name": name, "arguments": json.dumps(arguments)}}],
        }
    }


# --------------------------------------------------------------------- #
# Payload parsing
# --------------------------------------------------------------------- #
def test_extract_action_handles_tool_calls():
    action, params, call_id = extract_action(tool_payload("check_availability", {"service": "botox"}))
    assert action == "check_availability"
    assert params == {"service": "botox"}
    assert call_id == "call_test_1"


def test_extract_action_handles_legacy_function_call():
    payload = {
        "message": {
            "type": "function-call",
            "call": {"id": "call_9"},
            "functionCall": {"name": "get_pricing", "parameters": {"service": "fillers"}},
        }
    }
    action, params, call_id = extract_action(payload)
    assert (action, params, call_id) == ("get_pricing", {"service": "fillers"}, "call_9")


def test_extract_action_handles_a_flat_body():
    action, params, _ = extract_action({"action": "get_pricing", "parameters": {"service": "botox"}})
    assert action == "get_pricing"
    assert params["service"] == "botox"


# --------------------------------------------------------------------- #
# Call lifecycle
# --------------------------------------------------------------------- #
def test_inbound_recognises_a_returning_patient(db, service, patient):
    result = service.handle_inbound(inbound_payload())
    assert result["known_patient"] is True
    assert "Jane" in result["greeting"]
    assert result["assistant_overrides"]["variableValues"]["PATIENT_FIRST_NAME"] == "Jane"

    record = db.query(VoiceCall).one()
    assert record.patient_id == patient.id
    assert record.outcome == VoiceCallOutcome.IN_PROGRESS


def test_inbound_handles_an_unknown_caller(db, service):
    result = service.handle_inbound(inbound_payload(number="+15559998888"))
    assert result["known_patient"] is False
    assert result["assistant_overrides"]["variableValues"]["PATIENT_FIRST_NAME"] == ""


def test_caller_number_is_encrypted_at_rest(db, service, patient):
    service.handle_inbound(inbound_payload())
    import sqlite3

    from app.config import settings

    path = settings.sqlalchemy_url.split("///")[-1]
    connection = sqlite3.connect(path)
    try:
        raw = connection.execute("SELECT encrypted_caller_number FROM voice_calls").fetchone()[0]
    finally:
        connection.close()
    assert "5551234567" not in raw


def test_end_of_call_encrypts_the_transcript(db, service, patient):
    service.handle_inbound(inbound_payload())
    result = service.handle_end(
        call_id="call_test_1",
        transcript="Patient: Hi it's Jane, I take warfarin. Bella: I'll have a provider call you.",
        duration_seconds=95,
        outcome=None,
        ended_reason="customer-ended-call",
        summary={},
    )
    assert result["duration_seconds"] == 95

    record = db.query(VoiceCall).one()
    assert "warfarin" in record.transcript  # decrypted through the ORM

    import sqlite3

    from app.config import settings

    connection = sqlite3.connect(settings.sqlalchemy_url.split("///")[-1])
    try:
        raw = connection.execute("SELECT transcript FROM voice_calls").fetchone()[0]
    finally:
        connection.close()
    assert "warfarin" not in raw
    assert "Jane" not in raw


def test_free_text_summary_is_not_stored_verbatim(db, service, patient):
    """A call summary can quote the patient, so only its length is kept."""
    service.handle_inbound(inbound_payload())
    from app.routers.voice import _parse_end_payload

    parsed = _parse_end_payload(
        {
            "message": {
                "type": "end-of-call-report",
                "call": {"id": "call_test_1"},
                "summary": "Jane called about her Botox and mentioned she is on warfarin.",
                "durationSeconds": 60,
            }
        }
    )
    assert "warfarin" not in str(parsed.summary)
    assert parsed.summary["summary_length"] > 0


# --------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------- #
def test_check_availability_returns_speakable_slots(db, service):
    result = service.handle_action(
        action="check_availability", parameters={"service": "botox"}, call_id=None
    )
    assert result["result"]["slots"]
    assert " at " in result["speech"]
    # Slots must be real timestamps, not invented prose.
    assert result["result"]["slots"][0]["start"].endswith("Z")


def test_book_appointment_creates_a_pending_appointment(db, service):
    service.handle_inbound(inbound_payload(number="+15557778888"))
    slots = service.handle_action(
        action="check_availability", parameters={"service": "botox"}, call_id="call_test_1"
    )["result"]["slots"]

    result = service.handle_action(
        action="book_appointment",
        parameters={
            "service": "botox",
            "slot_start": slots[0]["start"],
            "patient_name": "Sam Rivera",
            "patient_phone": "+15557778888",
        },
        call_id="call_test_1",
    )

    appointment = db.query(Appointment).one()
    assert appointment.status == AppointmentStatus.PENDING, "voice bookings are front-desk confirmed"
    assert appointment.source == "voice"
    assert result["result"]["appointment_id"] == str(appointment.id)
    assert "all set" in result["speech"]

    record = db.query(VoiceCall).one()
    assert record.outcome == VoiceCallOutcome.BOOKED
    assert record.appointment_id == appointment.id


def test_booking_without_a_time_asks_rather_than_guesses(db, service):
    result = service.handle_action(
        action="book_appointment",
        parameters={"service": "botox", "patient_phone": "+15551110000"},
        call_id=None,
    )
    assert result["result"]["error"] == "missing_slot"
    assert db.query(Appointment).count() == 0


def test_booked_slot_is_no_longer_offered(db, service):
    slots = service.handle_action(
        action="check_availability", parameters={"service": "botox", "limit": 3}, call_id=None
    )["result"]["slots"]
    taken = slots[0]["start"]

    service.handle_action(
        action="book_appointment",
        parameters={"service": "botox", "slot_start": taken, "patient_phone": "+15551110001"},
        call_id=None,
    )

    remaining = service.handle_action(
        action="check_availability", parameters={"service": "botox", "limit": 3}, call_id=None
    )["result"]["slots"]
    assert taken not in [slot["start"] for slot in remaining]


def test_reschedule_resets_the_reminder_cycle(db, service, patient):
    service.handle_inbound(inbound_payload())
    slots = service.handle_action(
        action="check_availability", parameters={"service": "botox"}, call_id="call_test_1"
    )["result"]["slots"]
    service.handle_action(
        action="book_appointment",
        parameters={"service": "botox", "slot_start": slots[0]["start"], "patient_phone": patient.phone},
        call_id="call_test_1",
    )
    appointment = db.query(Appointment).one()
    appointment.reminder_24h_sent_at = appointment.created_at
    db.commit()

    service.handle_action(
        action="reschedule_appointment",
        parameters={"new_slot_start": slots[2]["start"]},
        call_id="call_test_1",
    )
    db.refresh(appointment)
    assert appointment.reminder_24h_sent_at is None, "a moved appointment needs a fresh reminder"


def test_cancel_offers_to_rebook(db, service, patient):
    service.handle_inbound(inbound_payload())
    slots = service.handle_action(
        action="check_availability", parameters={"service": "botox"}, call_id="call_test_1"
    )["result"]["slots"]
    service.handle_action(
        action="book_appointment",
        parameters={"service": "botox", "slot_start": slots[0]["start"], "patient_phone": patient.phone},
        call_id="call_test_1",
    )

    result = service.handle_action(
        action="cancel_appointment", parameters={}, call_id="call_test_1"
    )
    assert result["result"]["status"] == AppointmentStatus.CANCELLED
    assert "rebook" in result["speech"]


def test_pricing_comes_from_the_price_list(db, service):
    result = service.handle_action(action="get_pricing", parameters={"service": "botox"}, call_id=None)
    assert result["result"]["label"] == "Botox"
    assert "$" in result["speech"]


def test_clinical_question_is_escalated_not_answered(db, service, patient):
    service.handle_inbound(inbound_payload())
    result = service.handle_action(
        action="answer_faq",
        parameters={"question": "Is Botox safe while I'm taking blood thinners?"},
        call_id="call_test_1",
    )
    assert "2 hours" in result["speech"]
    assert result["result"]["callback_logged"] is True

    record = db.query(VoiceCall).one()
    assert record.outcome == VoiceCallOutcome.CALLBACK_REQUESTED
    # The question itself must not land in the non-encrypted summary column.
    assert "blood thinners" not in str(record.summary)
    assert record.summary["handoff_reason"] == "medical_question"


def test_request_callback_records_priority(db, service, patient):
    service.handle_inbound(inbound_payload())
    service.handle_action(
        action="request_callback",
        parameters={"reason": "medical_question", "priority": "urgent", "callback_number": patient.phone},
        call_id="call_test_1",
    )
    record = db.query(VoiceCall).one()
    assert record.summary["priority"] == "urgent"


def test_unknown_action_degrades_gracefully(db, service):
    result = service.handle_action(action="order_pizza", parameters={}, call_id=None)
    assert result["result"]["error"] == "unknown_action"
    assert result["speech"]


# --------------------------------------------------------------------- #
# HTTP layer
# --------------------------------------------------------------------- #
def test_voice_endpoints_require_the_vapi_secret(client):
    response = client.post("/voice/inbound", json=inbound_payload())
    assert response.status_code == 401


def test_voice_inbound_over_http(client, vapi_headers):
    response = client.post("/voice/inbound", json=inbound_payload(), headers=vapi_headers)
    assert response.status_code == 200
    assert "call_record_id" in response.json()


def test_single_url_dispatcher_routes_by_message_type(client, vapi_headers):
    assert (
        client.post("/webhooks/vapi", json=inbound_payload(), headers=vapi_headers).status_code == 200
    )

    response = client.post(
        "/webhooks/vapi",
        json=tool_payload("get_pricing", {"service": "fillers"}),
        headers=vapi_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["toolCallId"] == "tc_1"
    assert "$" in body["speech"]

    ended = client.post(
        "/webhooks/vapi",
        json={
            "message": {
                "type": "end-of-call-report",
                "call": {"id": "call_test_1"},
                "endedReason": "customer-ended-call",
                "durationSeconds": 42,
                "artifact": {"transcript": "hello"},
            }
        },
        headers=vapi_headers,
    )
    assert ended.status_code == 200
    assert ended.json()["duration_seconds"] == 42
