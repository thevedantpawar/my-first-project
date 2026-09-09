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


# --------------------------------------------------------------------------- #
# Rate limiting on the provider webhooks
#
# The shared secret is the real control; compare_digest removes the timing
# signal but not the guessing rate. Without a limit, an attacker gets as many
# attempts per minute as the network allows.
# --------------------------------------------------------------------------- #
def test_wrong_vapi_secret_is_eventually_rate_limited(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "vapi_webhook_secret", "the-real-secret")

    statuses = [
        client.post(
            "/voice/inbound",
            json={"call_id": "c1", "caller_number": "+15550100"},
            headers={"X-Vapi-Secret": f"guess-{n}"},
        ).status_code
        for n in range(140)
    ]

    assert 401 in statuses, "wrong secrets must be rejected"
    assert 429 in statuses, "guessing must not be allowed at an unbounded rate"


def test_the_limit_is_generous_enough_for_a_real_call(client, monkeypatch):
    """A real assistant sends a handful of requests per call, not hundreds."""
    from app.config import settings

    monkeypatch.setattr(settings, "vapi_webhook_secret", "the-real-secret")

    statuses = [
        client.post(
            "/voice/inbound",
            json={"call_id": f"call-{n}", "caller_number": "+15550100"},
            headers={"X-Vapi-Secret": "the-real-secret"},
        ).status_code
        for n in range(20)
    ]
    assert 429 not in statuses, "ordinary call traffic must not be throttled"


# --------------------------------------------------------------------------- #
# The assistant-request response has to be in VAPI's dialect, not ours
# --------------------------------------------------------------------------- #
def test_assistant_request_answers_in_the_shape_vapi_actually_reads(
    client, vapi_headers, monkeypatch
):
    """``assistantOverrides``, camelCase, alongside an assistant id.

    Returning the engine's own ``assistant_overrides`` is not an error VAPI
    reports. It is ignored: the personalised greeting never applies and the
    caller hears the assistant's static first message, which sounds exactly
    like a working integration. The only way to notice is to read the body.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "vapi_assistant_id", "asst_live_123", raising=False)

    response = client.post("/webhooks/vapi", json=inbound_payload(), headers=vapi_headers)
    assert response.status_code == 200
    body = response.json()

    assert body["assistantId"] == "asst_live_123"
    assert "assistantOverrides" in body, (
        "VAPI reads assistantOverrides; assistant_overrides is silently dropped"
    )
    assert "assistant_overrides" not in body

    overrides = body["assistantOverrides"]
    assert overrides["firstMessage"], "the personalised greeting is the point of the call"
    assert "variableValues" in overrides


def test_assistant_request_declines_audibly_when_no_assistant_is_configured(
    client, vapi_headers, monkeypatch
):
    """A half-configured number should say something, not drop the call.

    VAPI only asks for an assistant when the phone number has none attached, so
    an assistant-request with no VAPI_ASSISTANT_ID set means the number is
    misconfigured. Returning an invalid body there fails the call with nothing
    the caller or the log can act on.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "vapi_assistant_id", None, raising=False)

    response = client.post("/webhooks/vapi", json=inbound_payload(), headers=vapi_headers)
    assert response.status_code == 200
    assert response.json()["error"], "VAPI needs an error string to speak to the caller"


def test_the_call_is_still_recorded_even_when_the_assistant_is_unconfigured(
    client, vapi_headers, monkeypatch, db
):
    """Declining the assistant must not lose the fact that someone rang.

    A missed call from a misconfigured number is still a lead.
    """
    from app.config import settings
    from app.models.voice_call import VoiceCall

    monkeypatch.setattr(settings, "vapi_assistant_id", None, raising=False)
    before = db.query(VoiceCall).count()

    client.post("/webhooks/vapi", json=inbound_payload(), headers=vapi_headers)

    db.expire_all()
    assert db.query(VoiceCall).count() == before + 1


# --------------------------------------------------------------------------- #
# A caller names a wall-clock time, not an instant in UTC
# --------------------------------------------------------------------------- #
def test_a_spoken_time_is_booked_in_the_clinics_own_timezone(client, vapi_headers, db):
    """"Two o'clock" means two o'clock where the clinic is.

    A voice agent transcribing a spoken time has no offset to attach, so it
    sends a naive timestamp. Reading that as UTC books an America/New_York
    clinic four hours early: the caller asks for 2pm and the appointment lands
    at 10am. Nothing about the stored row looks wrong — it is found when
    somebody arrives to an empty waiting room.
    """
    from app.models.appointment import Appointment
    from app.utils import to_clinic_time

    response = client.post(
        "/webhooks/vapi",
        json=tool_payload(
            "book_appointment",
            {
                "service": "botox",
                "slot_start": "2099-09-15T14:00:00",
                "patient_phone": "+15550001111",
                "patient_name": "Wall Clock",
            },
        ),
        headers=vapi_headers,
    )
    assert response.status_code == 200

    appointment = (
        db.query(Appointment).order_by(Appointment.created_at.desc()).first()
    )
    assert appointment is not None
    local = to_clinic_time(appointment.scheduled_for)
    assert local.hour == 14, (
        f"caller asked for 14:00 clinic time, appointment is at {local.hour}:00 local"
    )


def test_an_explicit_offset_is_honoured_and_not_shifted_again(client, vapi_headers, db):
    """The engine's own slot values carry a Z, so echoing one must round-trip."""
    from app.models.appointment import Appointment

    client.post(
        "/webhooks/vapi",
        json=tool_payload(
            "book_appointment",
            {
                "service": "botox",
                "slot_start": "2099-09-16T18:00:00Z",
                "patient_phone": "+15550002222",
                "patient_name": "Explicit Offset",
            },
        ),
        headers=vapi_headers,
    )

    appointment = db.query(Appointment).order_by(Appointment.created_at.desc()).first()
    assert appointment is not None
    assert appointment.scheduled_for.hour == 18, (
        "an explicit Z is already UTC and must not be shifted by the clinic offset"
    )


def test_the_model_is_given_the_slot_values_not_just_the_sentence(client, vapi_headers):
    """Otherwise it has to invent a timestamp from prose when it books.

    check_availability's spoken form is "I have Tuesday at 2pm or ...". If that
    is all the model ever sees, the ISO string it sends to book_appointment is
    reconstructed rather than echoed — and a reconstruction has no offset.
    """
    response = client.post(
        "/webhooks/vapi",
        json=tool_payload("check_availability", {"service": "botox"}),
        headers=vapi_headers,
    )
    assert response.status_code == 200

    shown = response.json()["results"][0]["result"]
    assert isinstance(shown, str), "VAPI hands the model text"
    # The machine-readable start of an offered slot has to be in there.
    assert "start" in shown, (
        "the model needs the slot's start value to echo back, not only its label"
    )
    assert "Z" in shown, "and it has to carry an explicit offset"


def test_a_tool_call_id_is_never_null(client, vapi_headers):
    """VAPI rejects a results entry whose toolCallId is null."""
    response = client.post(
        "/webhooks/vapi",
        json={
            "message": {
                "type": "tool-calls",
                "call": {"id": "call_test_1"},
                "toolCalls": [{"function": {"name": "get_pricing", "arguments": {}}}],
            }
        },
        headers=vapi_headers,
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["toolCallId"] == ""


# --------------------------------------------------------------------------- #
# The availability rules have to apply on the way in, not only on the way out
# --------------------------------------------------------------------------- #
def _book(client, headers, **params):
    return client.post(
        "/webhooks/vapi", json=tool_payload("book_appointment", params), headers=headers
    )


def test_the_same_slot_cannot_be_booked_twice(client, vapi_headers, db):
    """Two callers, one slot. Both used to be told they were all set.

    get_available_slots excluded booked windows, so the agent would not *offer*
    a taken slot — but nothing checked on the way in, and a caller who names a
    time directly never goes through the offer path.
    """
    from app.models.appointment import Appointment

    first = _book(
        client, vapi_headers,
        service="botox", slot_start="2099-09-15T14:00:00",
        patient_phone="+15550003333", patient_name="First Caller",
    )
    assert first.json()["result"].get("appointment_id"), first.json()

    second = _book(
        client, vapi_headers,
        service="botox", slot_start="2099-09-15T14:00:00",
        patient_phone="+15550004444", patient_name="Second Caller",
    )
    body = second.json()
    assert body["result"].get("error") == "taken", body
    assert "taken" in body["speech"].lower()

    booked = (
        db.query(Appointment)
        .filter(Appointment.service == "botox")
        .filter(Appointment.scheduled_for.isnot(None))
        .all()
    )
    at_that_time = [a for a in booked if a.scheduled_for.hour == 18]
    assert len(at_that_time) == 1, "the second caller must not get a row"


def test_a_time_in_the_past_is_refused(client, vapi_headers):
    body = _book(
        client, vapi_headers,
        service="botox", slot_start="2020-01-06T14:00:00",
        patient_phone="+15550005555",
    ).json()
    assert body["result"]["error"] == "past", body
    assert body["speech"]


def test_a_time_outside_opening_hours_is_refused(client, vapi_headers):
    """3am is not a bookable appointment, however clearly the caller said it."""
    body = _book(
        client, vapi_headers,
        service="botox", slot_start="2099-09-15T03:00:00",
        patient_phone="+15550006666",
    ).json()
    assert body["result"]["error"] == "closed", body


def test_sunday_is_refused(client, vapi_headers):
    body = _book(
        client, vapi_headers,
        service="botox", slot_start="2099-09-20T14:00:00",
        patient_phone="+15550007777",
    ).json()
    assert body["result"]["error"] == "closed", body


def test_a_refusal_always_offers_a_way_forward(client, vapi_headers):
    """"That doesn't work" with no next step is where a call gets abandoned."""
    for slot in ("2020-01-06T14:00:00", "2099-09-15T03:00:00", "2099-09-20T14:00:00"):
        speech = _book(
            client, vapi_headers, service="botox", slot_start=slot,
            patient_phone="+15550008888",
        ).json()["speech"]
        assert "?" in speech, f"no question asked back for {slot}: {speech!r}"


def test_rescheduling_onto_its_own_time_is_not_a_collision(client, vapi_headers, db):
    """An appointment must not be found to collide with itself."""
    from app.models.appointment import Appointment

    created = _book(
        client, vapi_headers,
        service="botox", slot_start="2099-09-16T15:00:00",
        patient_phone="+15550009999", patient_name="Mover",
    ).json()
    appointment_id = created["result"]["appointment_id"]

    response = client.post(
        "/webhooks/vapi",
        json=tool_payload(
            "reschedule_appointment",
            {"appointment_id": appointment_id, "new_slot_start": "2099-09-16T15:00:00"},
        ),
        headers=vapi_headers,
    )
    body = response.json()
    assert body["result"].get("error") != "taken", (
        "moving an appointment to the time it already has is a no-op, not a clash"
    )


def test_rescheduling_onto_a_taken_slot_is_refused(client, vapi_headers):
    from_one = _book(
        client, vapi_headers,
        service="botox", slot_start="2099-09-16T16:00:00",
        patient_phone="+15550010001", patient_name="Holder",
    ).json()
    assert from_one["result"].get("appointment_id")

    mover = _book(
        client, vapi_headers,
        service="botox", slot_start="2099-09-16T17:00:00",
        patient_phone="+15550010002", patient_name="Mover Two",
    ).json()

    response = client.post(
        "/webhooks/vapi",
        json=tool_payload(
            "reschedule_appointment",
            {
                "appointment_id": mover["result"]["appointment_id"],
                "new_slot_start": "2099-09-16T16:00:00",
            },
        ),
        headers=vapi_headers,
    )
    assert response.json()["result"].get("error") == "taken", response.json()
