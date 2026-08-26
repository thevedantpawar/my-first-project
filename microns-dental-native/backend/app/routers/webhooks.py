"""Inbound webhooks: Google Calendar, VAPI, Twilio, Calendly.

``POST /retention/calendar-webhook`` is Module 1/2/3's actual trigger: Google
Calendar's push-notification channel (registered via
``GoogleCalendarService.watch``) delivers only a header ping — no event
payload — so this handler re-queries the calendar for whatever changed since
the last ping and dispatches to the right module. Register one channel per
calendar you need pinged, with ``?calendar_id=`` on the callback URL so a
shared endpoint knows which one just changed (see the README's Calendar
push-notification section for the exact ``events.watch`` call and its
required renewal cron — channels expire after at most 30 days).
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_audit
from app.routers.voice import _parse_end_payload, verify_vapi_secret
from app.schemas import ActionResult
from app.services.emergency_service import EmergencyCaptureService
from app.services.google_calendar_service import GoogleCalendarService
from app.services.hipaa_audit import HIPAAAuditLogger
from app.services.lead_service import LeadService
from app.services.retention_service import RetentionService
from app.services.sms_service import SMSService
from app.services.treatment_plan_service import TreatmentPlanService
from app.services.voice_service import VoiceService, extract_action
from app.utils import parse_datetime, utcnow

logger = logging.getLogger(__name__)

router = APIRouter(tags=["webhooks"])


# --------------------------------------------------------------------- #
# VAPI single-URL dispatcher
# --------------------------------------------------------------------- #
@router.post("/webhooks/vapi")
async def vapi_dispatch(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    _: None = Depends(verify_vapi_secret),
) -> dict[str, Any]:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    event_type = str(message.get("type") or payload.get("type") or "").strip()
    service = VoiceService(db, audit)

    if event_type in {"assistant-request", "call.started"}:
        return service.handle_inbound(payload)

    if event_type in {"tool-calls", "function-call", "tool_call"}:
        action_name, parameters, call_id = extract_action(payload)
        if not action_name:
            return {"result": {}, "speech": None}
        result = service.handle_action(action=action_name, parameters=parameters, call_id=call_id)
        return {
            "results": [{"toolCallId": _first_tool_call_id(payload), "result": result.get("speech") or ""}],
            "result": result.get("result", {}),
            "speech": result.get("speech"),
        }

    if event_type in {"end-of-call-report", "call.ended", "hang"}:
        parsed = _parse_end_payload(payload)
        return service.handle_end(
            call_id=parsed.call_id, transcript=parsed.transcript, duration_seconds=parsed.duration_seconds,
            outcome=parsed.outcome, ended_reason=parsed.ended_reason, summary=parsed.summary,
        )

    logger.info("Ignoring VAPI event type: %s", event_type or "(none)")
    return {"status": "ignored", "type": event_type}


def _first_tool_call_id(payload: dict[str, Any]) -> Optional[str]:
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    calls = message.get("toolCalls") or message.get("toolCallList") or []
    if isinstance(calls, list) and calls and isinstance(calls[0], dict):
        return calls[0].get("id")
    return None


# --------------------------------------------------------------------- #
# Google Calendar — the primary trigger source (Modules 1, 2, 3)
# --------------------------------------------------------------------- #
@router.post("/retention/calendar-webhook")
async def calendar_webhook(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    x_goog_resource_state: Optional[str] = Header(default=None, alias="X-Goog-Resource-State"),
    x_goog_channel_id: Optional[str] = Header(default=None, alias="X-Goog-Channel-ID"),
) -> dict[str, Any]:
    """Google's push ping. Carries no event data — re-query and dispatch."""
    if x_goog_resource_state == "sync":
        # The channel-creation handshake. Nothing changed yet.
        return {"status": "sync_ack"}

    calendar_id = request.query_params.get("calendar_id") or settings.google_primary_calendar_id
    calendar = GoogleCalendarService()
    changed = calendar.search_future_events(
        calendar_id, time_min=utcnow() - timedelta(days=1), time_max=utcnow() + timedelta(days=60), max_results=250
    )

    processed = {"ended": 0, "booked": 0}
    for event in changed:
        status = event.get("status")
        if status == "cancelled":
            continue
        end = parse_datetime((event.get("end") or {}).get("dateTime") or (event.get("end") or {}).get("date"))
        start = parse_datetime((event.get("start") or {}).get("dateTime") or (event.get("start") or {}).get("date"))
        event_id = event.get("id")
        if not event_id:
            continue

        if end is not None and end <= utcnow():
            result = RetentionService(db, audit).handle_appointment_ended(calendar_id=calendar_id, google_event_id=event_id)
            if result.get("status") == "processed":
                processed["ended"] += 1
                TreatmentPlanService(db, audit).handle_consultation_ended(calendar_id=calendar_id, google_event_id=event_id)
        elif start is not None and start > utcnow():
            recall_result = RetentionService(db, audit).handle_new_booking(calendar_id=calendar_id, google_event_id=event_id)
            tp_results = TreatmentPlanService(db, audit).handle_new_booking_event(calendar_id=calendar_id, google_event_id=event_id)
            if recall_result.get("status") == "processed" or tp_results:
                processed["booked"] += 1

    return {"status": "processed", "channel_id": x_goog_channel_id, "counts": processed}


# --------------------------------------------------------------------- #
# Twilio — inbound SMS (emergency-capture replies + lead qualification)
# --------------------------------------------------------------------- #
@router.post("/webhooks/twilio/sms")
async def twilio_inbound_sms(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> dict[str, str]:
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}
    signature = request.headers.get("X-Twilio-Signature")
    if not SMSService.validate_signature(str(request.url), params, signature):
        audit.log_denied(reason="invalid_twilio_signature", user_id="twilio")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    from_phone = params.get("From", "")
    body = params.get("Body", "")

    # A pending emergency case always wins the routing decision — a lead
    # mid-qualification who is also mid-emergency-triage should hear from the
    # on-call dentist, not the next scripted question.
    emergency_result = EmergencyCaptureService(db, audit).handle_reply(from_phone=from_phone, body=body)
    if emergency_result.get("status") != "ignored":
        return {"status": "ok"}

    LeadService(db, audit).handle_sms(from_phone=from_phone, body=body)
    return {"status": "ok"}


@router.post("/webhooks/twilio/voice-status")
async def twilio_voice_status(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> dict[str, str]:
    """A call's status callback — the after-hours missed-call trigger."""
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}
    signature = request.headers.get("X-Twilio-Signature")
    if not SMSService.validate_signature(str(request.url), params, signature):
        audit.log_denied(reason="invalid_twilio_signature", user_id="twilio")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    call_status = (params.get("CallStatus") or "").lower()
    from_number = params.get("From", "")
    missed = call_status in {"no-answer", "busy", "failed"} or params.get("CallDuration") == "0"
    if from_number:
        EmergencyCaptureService(db, audit).handle_missed_call(caller_number=from_number, missed=missed)
    return {"status": "ok"}


@router.post("/webhooks/twilio/status")
async def twilio_sms_status(
    request: Request, db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit),
) -> dict[str, str]:
    """Twilio SMS delivery-status callback. Only the SID and status are recorded."""
    from app.services.hipaa_audit import DataCategory

    form = await request.form()
    params = {key: str(value) for key, value in form.items()}
    signature = request.headers.get("X-Twilio-Signature")
    if not SMSService.validate_signature(str(request.url), params, signature):
        audit.log_denied(reason="invalid_twilio_signature", user_id="twilio")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    audit.log_access(
        "sms_status", None, DataCategory.PHONE, "twilio",
        outcome=params.get("MessageStatus", "unknown"),
        details={"message_sid": params.get("MessageSid"), "error_code": params.get("ErrorCode")},
    )
    db.commit()
    return {"status": "ok"}


# --------------------------------------------------------------------- #
# Calendly — a lead actually picked a time (hot-lead auto-hold confirmation)
# --------------------------------------------------------------------- #
@router.post("/webhooks/calendly", response_model=ActionResult)
async def calendly_event(
    request: Request, db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be JSON")

    event = payload.get("event")
    resource = payload.get("payload") or {}
    if event not in {"invitee.created", "invitee.canceled"}:
        return ActionResult(status="ignored", detail=str(event))

    email = resource.get("email")
    from app.models.lead import Lead, LeadStatus
    from app.services.encryption import get_encryption_service
    from sqlalchemy import select

    lead: Optional[Lead] = None
    if email:
        fingerprint = get_encryption_service().fingerprint(email)
        lead = db.execute(
            select(Lead).where(Lead.email_fingerprint == fingerprint).order_by(Lead.created_at.desc())
        ).scalars().first()
    if lead is None:
        return ActionResult(status="ignored", detail="lead not matched")

    if event == "invitee.created":
        lead.status = LeadStatus.BOOKED
        lead.calendly_event_id = (resource.get("event") or "").split("/")[-1] or None
        lead.next_action = "consultation_booked"
    else:
        lead.status = LeadStatus.QUALIFIED
        lead.next_action = "staff_followup_call"

    from app.services.hipaa_audit import DataCategory

    audit.log_access("update", None, DataCategory.LEAD_QUALIFICATION, "calendly", details={"event": event, "status": lead.status})
    db.commit()
    return ActionResult(status=lead.status, data={"lead_id": str(lead.id)})
