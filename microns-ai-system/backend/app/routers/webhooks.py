"""Inbound webhooks: VAPI, Twilio, the booking system, Calendly, n8n.

``POST /webhooks/vapi`` is the single-URL dispatcher. VAPI posts every event
type to one ``serverUrl``, so this route reads ``message.type`` and forwards to
the same handlers that back ``/voice/inbound``, ``/voice/action`` and
``/voice/end``. Point VAPI at either — the split routes if you prefer explicit
URLs per event, this one if you want the default single-URL setup.
"""

from __future__ import annotations

import logging
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit
from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.lead import Lead, LeadStatus
from app.routers.voice import _parse_end_payload, verify_vapi_secret
from app.schemas import ActionResult
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.notifier import notify_treatment_completed
from app.services.patient_service import get_or_create_patient
from app.services.retention_service import RetentionService
from app.services.voice_service import VoiceService, extract_action
from app.utils import parse_datetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


class TreatmentCompleted(BaseModel):
    appointment_id: Optional[UUID] = None
    external_id: Optional[str] = None


class BookingSystemEvent(BaseModel):
    """Normalised event from Acuity/Square/Mindbody."""

    event: str  # "appointment.created" | "appointment.cancelled" | "appointment.completed"
    external_id: str
    phone: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    service: Optional[str] = None
    scheduled_for: Optional[str] = None
    duration_minutes: int = 30


# --------------------------------------------------------------------- #
# VAPI single-URL dispatcher
# --------------------------------------------------------------------- #
@router.post("/vapi")
async def vapi_dispatch(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    _: None = Depends(verify_vapi_secret),
) -> dict[str, Any]:
    """Route a VAPI server event by ``message.type``."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    event_type = str(message.get("type") or payload.get("type") or "").strip()
    service = VoiceService(db, audit)

    if event_type in {"assistant-request", "call.started", "status-update"} and event_type != "status-update":
        return service.handle_inbound(payload)

    if event_type in {"tool-calls", "function-call", "tool_call"}:
        action_name, parameters, call_id = extract_action(payload)
        if not action_name:
            return {"result": {}, "speech": None}
        result = service.handle_action(action=action_name, parameters=parameters, call_id=call_id)
        # VAPI reads `results` for tool calls and `result` for function calls;
        # returning both keeps this compatible with either assistant config.
        return {
            "results": [{"toolCallId": _first_tool_call_id(payload), "result": result.get("speech") or ""}],
            "result": result.get("result", {}),
            "speech": result.get("speech"),
        }

    if event_type in {"end-of-call-report", "call.ended", "hang"}:
        parsed = _parse_end_payload(payload)
        return service.handle_end(
            call_id=parsed.call_id,
            transcript=parsed.transcript,
            duration_seconds=parsed.duration_seconds,
            outcome=parsed.outcome,
            ended_reason=parsed.ended_reason,
            summary=parsed.summary,
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
# Treatment completed → starts the review clock
# --------------------------------------------------------------------- #
@router.post("/treatment-completed", response_model=ActionResult)
def treatment_completed(
    payload: TreatmentCompleted,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """Mark a treatment complete and trigger the review workflow."""
    appointment = _resolve_appointment(db, payload.appointment_id, payload.external_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")

    result = RetentionService(db, audit).treatment_completed(appointment.id)
    notify_treatment_completed(appointment)
    return ActionResult(status="completed", data=result)


# --------------------------------------------------------------------- #
# Twilio delivery status
# --------------------------------------------------------------------- #
@router.post("/twilio/status")
async def twilio_status(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> dict[str, str]:
    """Twilio delivery-status callback.

    Signature-checked, and only the SID and status are recorded — never the
    message body.
    """
    from app.services.sms_service import SMSService

    form = await request.form()
    params = {key: str(value) for key, value in form.items()}
    signature = request.headers.get("X-Twilio-Signature")
    if not SMSService.validate_signature(str(request.url), params, signature):
        audit.log_denied(reason="invalid_twilio_signature", user_id="twilio")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    audit.log_access(
        "sms_status",
        None,
        DataCategory.PHONE,
        "twilio",
        outcome=params.get("MessageStatus", "unknown"),
        details={"message_sid": params.get("MessageSid"), "error_code": params.get("ErrorCode")},
    )
    db.commit()
    return {"status": "ok"}


# --------------------------------------------------------------------- #
# Booking system
# --------------------------------------------------------------------- #
@router.post("/booking-system", response_model=ActionResult)
def booking_system_event(
    payload: BookingSystemEvent,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """Keep the local calendar in step with Acuity/Square/Mindbody.

    Appointments booked at the front desk still need reminders, so they have to
    reach this database.
    """
    existing = db.execute(
        select(Appointment).where(Appointment.external_id == payload.external_id)
    ).scalars().first()

    if payload.event == "appointment.cancelled":
        if existing is None:
            return ActionResult(status="ignored", detail="unknown external_id")
        existing.status = AppointmentStatus.CANCELLED
        db.commit()
        return ActionResult(status="cancelled", data={"appointment_id": str(existing.id)})

    if payload.event == "appointment.completed":
        if existing is None:
            return ActionResult(status="ignored", detail="unknown external_id")
        result = RetentionService(db, audit).treatment_completed(existing.id)
        notify_treatment_completed(existing)
        return ActionResult(status="completed", data=result)

    if payload.event != "appointment.created":
        return ActionResult(status="ignored", detail=f"unhandled event {payload.event}")

    if existing is not None:
        return ActionResult(status="duplicate", data={"appointment_id": str(existing.id)})
    if not payload.phone or not payload.scheduled_for:
        raise HTTPException(status_code=400, detail="phone and scheduled_for are required")

    scheduled_for = parse_datetime(payload.scheduled_for)
    if scheduled_for is None:
        raise HTTPException(status_code=400, detail="scheduled_for must be ISO-8601")

    patient, _ = get_or_create_patient(
        db,
        phone=payload.phone,
        name=payload.name,
        email=payload.email,
        sms_consent=True,
        audit=audit,
        user_id="booking-system",
    )
    appointment = Appointment(
        patient_id=patient.id,
        external_id=payload.external_id,
        service=payload.service or "consultation",
        scheduled_for=scheduled_for,
        duration_minutes=payload.duration_minutes,
        status=AppointmentStatus.CONFIRMED,
        source=AppointmentSource.BOOKING_SYSTEM,
    )
    db.add(appointment)
    audit.log_write(str(patient.id), DataCategory.APPOINTMENT, "booking-system")
    db.commit()
    return ActionResult(status="created", data={"appointment_id": str(appointment.id)})


# --------------------------------------------------------------------- #
# Calendly
# --------------------------------------------------------------------- #
@router.post("/calendly", response_model=ActionResult)
async def calendly_event(
    request: Request,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """Calendly ``invitee.created`` — a hot lead actually picked a time.

    Until this arrives the lead holds a single-use scheduling link, which is a
    booking *offer*, not a booking. This is what flips it to ``booked``.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body must be JSON")

    event = payload.get("event")
    resource = payload.get("payload") or {}
    if event not in {"invitee.created", "invitee.canceled"}:
        return ActionResult(status="ignored", detail=str(event))

    email = resource.get("email")
    tracking = resource.get("tracking") or {}
    lead_id = tracking.get("utm_content") or resource.get("text_reminder_number")

    lead: Optional[Lead] = None
    if lead_id:
        try:
            lead = db.get(Lead, UUID(str(lead_id)))
        except (ValueError, TypeError):
            lead = None
    if lead is None and email:
        from app.services.encryption import get_encryption_service

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
        lead.next_action = "staff_followup_24h"

    audit.log_access(
        "update",
        None,
        DataCategory.LEAD_QUALIFICATION,
        "calendly",
        details={"event": event, "status": lead.status},
    )
    db.commit()
    return ActionResult(status=lead.status, data={"lead_id": str(lead.id)})


def _resolve_appointment(
    db: Session, appointment_id: Optional[UUID], external_id: Optional[str]
) -> Optional[Appointment]:
    if appointment_id is not None:
        appointment = db.get(Appointment, appointment_id)
        if appointment is not None:
            return appointment
    if external_id:
        return db.execute(
            select(Appointment).where(Appointment.external_id == external_id)
        ).scalars().first()
    return None
