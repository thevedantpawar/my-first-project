"""Retention endpoints — staff dashboards and manual triggers.

Machine-driven retention actions (the ones n8n calls on a schedule) live in
``routers/internal.py`` behind the internal token. These are the human-facing
ones.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_audit, require_staff
from app.models.appointment import Appointment, AppointmentStatus
from app.schemas import ActionResult, PatientAtRisk, ReviewReceived, TriggerReviewRequest
from app.services.hipaa_audit import HIPAAAuditLogger
from app.services.retention_service import RetentionService

router = APIRouter(prefix="/retention", tags=["retention"])


@router.get("/dashboard")
def dashboard(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """No-show rate, review velocity, reactivation and lead stats.

    Aggregates only — no row here identifies a patient.
    """
    return RetentionService(db, audit).dashboard(days=days)


@router.get("/patients-at-risk", response_model=list[PatientAtRisk])
def patients_at_risk(
    days: Optional[int] = Query(default=None, ge=1, le=730),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """Patients with no visit in N days (default 45) and nothing booked.

    Names are masked to 'Jane D.' — enough for a staff member to recognise
    someone they know, not enough to be a useful data leak.
    """
    return RetentionService(db, audit).patients_at_risk(days=days, limit=limit)


@router.post("/trigger-review", response_model=ActionResult)
def trigger_review(
    payload: TriggerReviewRequest,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    """Manually send a review request for a completed appointment."""
    service = RetentionService(db, audit)

    appointment_id = payload.appointment_id
    if appointment_id is None:
        if payload.patient_uuid is None:
            raise HTTPException(status_code=400, detail="appointment_id or patient_uuid is required")
        # Most recent completed visit for this patient.
        appointment = (
            db.execute(
                select(Appointment)
                .where(
                    Appointment.patient_id == payload.patient_uuid,
                    Appointment.status == AppointmentStatus.COMPLETED,
                )
                .order_by(Appointment.scheduled_for.desc())
                .limit(1)
            )
            .scalars()
            .first()
        )
        if appointment is None:
            raise HTTPException(status_code=404, detail="No completed appointment for that patient")
        appointment_id = appointment.id

    result = service.request_review(appointment_id, force=payload.force)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result["status"], detail=result.get("reason"), data=result)


@router.post("/reactivate/{patient_uuid}", response_model=ActionResult)
def reactivate_patient(
    patient_uuid: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    """Send a dormant-patient reactivation SMS (respects a 30-day cooldown)."""
    result = RetentionService(db, audit).send_dormant_reactivation(patient_uuid)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Patient not found")
    return ActionResult(status=result["status"], detail=result.get("reason"), data=result)


@router.post("/review-received", response_model=ActionResult)
def review_received(
    payload: ReviewReceived,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    """Record a review and draft a response for manager approval.

    The draft is never auto-published: replying publicly to a review confirms
    the person was a patient, which is a disclosure only a human should make.
    """
    result = RetentionService(db, audit).record_review(
        payload.appointment_id, rating=payload.rating, review_text=payload.review_text
    )
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result["status"], data=result)


@router.get("/events/{patient_uuid}")
def patient_timeline(
    patient_uuid: UUID,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """Retention timeline for one patient. Event types and timestamps only."""
    from app.models.retention_event import RetentionEvent

    audit.log_read(str(patient_uuid), "retention_timeline", user)
    rows = (
        db.execute(
            select(RetentionEvent)
            .where(RetentionEvent.patient_id == patient_uuid)
            .order_by(RetentionEvent.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [
        {
            "event_type": row.event_type,
            "channel": row.channel,
            "appointment_id": str(row.appointment_id) if row.appointment_id else None,
            "metadata": row.event_metadata,
            "created_at": row.created_at.isoformat() + "Z",
        }
        for row in rows
    ]


@router.get("/config")
def retention_config(user: str = Depends(require_staff)) -> dict:
    """Effective retention tuning — what the cron workflows will actually do."""
    return {
        "reactivation_days": settings.reactivation_days,
        "review_request_delay_days": settings.review_request_delay_days,
        "no_show_credit_amount": settings.no_show_credit_amount,
        "clinic_review_url": settings.clinic_review_url,
        "clinic_booking_url": settings.clinic_booking_url,
    }
