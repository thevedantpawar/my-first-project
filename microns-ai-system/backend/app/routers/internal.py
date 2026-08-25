"""Internal endpoints called by the n8n workflows.

**Why n8n never sends the SMS itself.** The workflows orchestrate *when*
something happens; the backend decides *what* is sent and *to whom*. That
choice buys three things:

* PHI (names, phone numbers) stays inside one service. n8n only ever handles
  UUIDs, so a workflow export, an execution log or a screenshot cannot leak a
  patient.
* Every message lands in the HIPAA audit trail, because there is exactly one
  code path that sends SMS.
* Consent and idempotency are enforced server-side, so a double-fired cron
  cannot double-text a patient.

If you prefer native Twilio nodes in n8n, see ``n8n-workflows/README.md`` — the
trade-off is documented there.

Every route requires ``X-Internal-Token``.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_audit, require_internal_token
from app.models.appointment import Appointment, AppointmentStatus
from app.models.lead import Lead, LeadStatus
from app.schemas import ActionResult, ReminderRequest, RetentionEventIn, ReviewReceived
from app.services.hipaa_audit import HIPAAAuditLogger
from app.services.retention_service import RetentionService
from app.utils import days_ago, utcnow

router = APIRouter(
    prefix="/internal",
    tags=["internal"],
    dependencies=[Depends(require_internal_token)],
)


class AppointmentRef(BaseModel):
    appointment_id: UUID


class NurtureRequest(BaseModel):
    lead_id: UUID
    step: int = Field(default=0, ge=0, le=10)


class CallbackRequest(BaseModel):
    call_id: Optional[str] = None
    patient_uuid: Optional[UUID] = None
    reason: str = "medical_question"
    #: Priority only — never the question itself, which is PHI.
    priority: str = "normal"


# --------------------------------------------------------------------- #
# Workflow A — reminders
# --------------------------------------------------------------------- #
@router.post("/reminders/send", response_model=ActionResult)
def send_reminder(
    payload: ReminderRequest,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """Send a 24h or 2h reminder. Idempotent — a repeat call returns ``skipped``."""
    result = RetentionService(db, audit).send_reminder(payload.appointment_id, kind=payload.kind)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result["status"], detail=result.get("reason"), data=result)


# --------------------------------------------------------------------- #
# Workflow B — no-show recovery
# --------------------------------------------------------------------- #
@router.post("/no-shows/detect", response_model=ActionResult)
def detect_no_shows(
    grace_hours: int = Query(default=2, ge=1, le=48),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """Flag past-due active appointments as no-shows."""
    flagged = RetentionService(db, audit).detect_no_shows(grace_hours=grace_hours)
    return ActionResult(status="ok", data={"flagged": len(flagged), "appointments": flagged})


@router.post("/no-shows/reactivate", response_model=ActionResult)
def reactivate_no_show(
    payload: AppointmentRef,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    result = RetentionService(db, audit).send_reactivation(payload.appointment_id)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result["status"], detail=result.get("reason"), data=result)


@router.post("/no-shows/credit-offer", response_model=ActionResult)
def credit_offer(
    payload: AppointmentRef,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """The '$N credit expires tomorrow' nudge, 3 days after a no-show."""
    result = RetentionService(db, audit).send_credit_offer(payload.appointment_id)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result["status"], detail=result.get("reason"), data=result)


@router.get("/no-shows/pending-credit")
def pending_credit_offers(
    days: int = Query(default=3, ge=1, le=30),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> list[dict]:
    """No-shows from ~``days`` ago that were reactivated but never rebooked.

    Workflow B's "3 days later, still no rebooking?" branch reads this instead
    of holding a three-day Wait node open, which would not survive an n8n
    restart.
    """
    service = RetentionService(db, audit)
    window_start = days_ago(days + 1)
    window_end = days_ago(days - 1)
    rows = (
        db.execute(
            select(Appointment).where(
                Appointment.status == AppointmentStatus.NO_SHOW,
                Appointment.scheduled_for >= window_start,
                Appointment.scheduled_for <= window_end,
                Appointment.credit_offer_sent_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "appointment_id": str(row.id),
            "patient_uuid": str(row.patient_id),
            "scheduled_for": row.scheduled_for.isoformat() + "Z",
            "reactivation_sent": row.reactivation_sent_at is not None,
        }
        for row in rows
        if not service.has_rebooked(row)
    ]


# --------------------------------------------------------------------- #
# Workflow C — reviews
# --------------------------------------------------------------------- #
@router.get("/reviews/pending")
def pending_reviews(
    delay_days: Optional[int] = Query(default=None, ge=0, le=90),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> list[dict]:
    """Completed appointments whose review window has opened.

    Same reasoning as ``/no-shows/pending-credit``: a five-day Wait node inside
    n8n is state that evaporates on restart, so the delay lives in the query.
    """
    delay = settings.review_request_delay_days if delay_days is None else delay_days
    cutoff = days_ago(delay)
    rows = (
        db.execute(
            select(Appointment)
            .where(
                Appointment.status == AppointmentStatus.COMPLETED,
                Appointment.completed_at.is_not(None),
                Appointment.completed_at <= cutoff,
                Appointment.review_requested_at.is_(None),
                Appointment.review_received_at.is_(None),
            )
            .order_by(Appointment.completed_at)
            .limit(200)
        )
        .scalars()
        .all()
    )
    return [
        {
            "appointment_id": str(row.id),
            "patient_uuid": str(row.patient_id),
            "completed_at": row.completed_at.isoformat() + "Z" if row.completed_at else None,
            "service": row.service,
        }
        for row in rows
    ]


@router.get("/reviews/status/{appointment_id}")
def review_status(
    appointment_id: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> dict:
    result = RetentionService(db, audit).review_status(appointment_id)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return result


@router.post("/reviews/request", response_model=ActionResult)
def request_review(
    payload: AppointmentRef,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    result = RetentionService(db, audit).request_review(payload.appointment_id)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result["status"], detail=result.get("reason"), data=result)


@router.post("/reviews/received", response_model=ActionResult)
def review_received(
    payload: ReviewReceived,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """Record a review and return a draft reply for manager approval."""
    result = RetentionService(db, audit).record_review(
        payload.appointment_id, rating=payload.rating, review_text=payload.review_text
    )
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result["status"], data=result)


# --------------------------------------------------------------------- #
# Dormant patients
# --------------------------------------------------------------------- #
@router.get("/dormant-patients")
def dormant_patients(
    days: Optional[int] = Query(default=None, ge=1, le=730),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> list[dict]:
    return RetentionService(db, audit).patients_at_risk(days=days, limit=limit)


@router.post("/dormant-patients/reactivate", response_model=ActionResult)
def reactivate_dormant(
    patient_uuid: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    result = RetentionService(db, audit).send_dormant_reactivation(patient_uuid)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Patient not found")
    return ActionResult(status=result["status"], detail=result.get("reason"), data=result)


# --------------------------------------------------------------------- #
# Leads
# --------------------------------------------------------------------- #
@router.get("/leads/pending-followup")
def pending_followup(
    hours: int = Query(default=24, ge=1, le=168),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> list[dict]:
    """Warm leads awaiting staff follow-up, and cold leads due a nurture touch."""
    rows = (
        db.execute(
            select(Lead)
            .where(
                Lead.status.in_((LeadStatus.QUALIFIED, LeadStatus.NURTURE)),
                Lead.created_at >= days_ago(30),
            )
            .order_by(Lead.qualification_score.desc(), Lead.created_at)
            .limit(200)
        )
        .scalars()
        .all()
    )
    return [
        {
            "lead_id": str(row.id),
            "status": row.status,
            "temperature": row.temperature,
            "score": row.qualification_score,
            "treatment_interest": row.treatment_interest,
            "timeline": row.timeline,
            "needs_provider_approval": row.needs_provider_approval,
            "hours_since_created": round((utcnow() - row.created_at).total_seconds() / 3600, 1),
            "overdue": (utcnow() - row.created_at).total_seconds() / 3600 > hours,
        }
        for row in rows
    ]


@router.post("/leads/nurture", response_model=ActionResult)
def send_nurture(
    payload: NurtureRequest,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """Send one educational SMS from the nurture drip to a cold lead."""
    from app.services.lead_service import LeadService

    result = LeadService(db, audit).send_nurture(payload.lead_id, step=payload.step)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Lead not found")
    return ActionResult(status=result["status"], detail=result.get("reason"), data=result)


# --------------------------------------------------------------------- #
# Voice handoff
# --------------------------------------------------------------------- #
@router.get("/voice/pending-callbacks")
def pending_callbacks(
    hours: int = Query(default=24, ge=1, le=168),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> list[dict]:
    """Calls that ended needing a clinical callback, still unresolved.

    Drives the voice-handoff workflow's escalation branch: anything older than
    the 2-hour promise the agent makes on the phone gets flagged.
    """
    from app.models.voice_call import VoiceCall, VoiceCallOutcome

    rows = (
        db.execute(
            select(VoiceCall)
            .where(
                VoiceCall.outcome.in_(
                    (VoiceCallOutcome.CALLBACK_REQUESTED, VoiceCallOutcome.TRANSFERRED)
                ),
                VoiceCall.created_at >= days_ago(max(hours // 24, 1)),
            )
            .order_by(VoiceCall.created_at)
            .limit(100)
        )
        .scalars()
        .all()
    )
    return [
        {
            "call_record_id": str(row.id),
            "vapi_call_id": row.vapi_call_id,
            "patient_uuid": str(row.patient_id) if row.patient_id else None,
            "outcome": row.outcome,
            "reason": (row.summary or {}).get("handoff_reason"),
            "created_at": row.created_at.isoformat() + "Z",
            "hours_waiting": round((utcnow() - row.created_at).total_seconds() / 3600, 1),
            "sla_breached": (utcnow() - row.created_at).total_seconds() / 3600 > 2,
        }
        for row in rows
    ]


# --------------------------------------------------------------------- #
# Generic event logging
# --------------------------------------------------------------------- #
@router.post("/retention/events", response_model=ActionResult)
def log_event(
    payload: RetentionEventIn,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
) -> ActionResult:
    """Record a retention event from a workflow ('reminder_sent', etc.)."""
    event = RetentionService(db, audit).record_event(
        event_type=payload.event_type,
        patient_id=payload.patient_uuid,
        appointment_id=payload.appointment_id,
        lead_id=payload.lead_id,
        channel=payload.channel,
        metadata=payload.metadata,
    )
    db.commit()
    return ActionResult(status="recorded", data={"event_id": str(event.id)})
