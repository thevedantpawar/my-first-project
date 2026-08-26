"""Retention endpoints — front-desk/dentist dashboards and manual triggers.

Machine-driven actions (the ones a cron or n8n calls on a schedule) live in
``routers/internal.py`` behind the internal token. These are the human-facing
ones, matching the ``/retention/*`` paths the spec calls out for Module 1.
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
from app.schemas import ActionResult, PatientAtRisk, ReviewReceived, TriggerRecallRequest, TriggerReviewRequest
from app.services.hipaa_audit import HIPAAAuditLogger
from app.services.retention_service import RetentionService
from app.utils import utcnow

router = APIRouter(prefix="/retention", tags=["retention"])


@router.get("/dashboard")
def dashboard(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """Recall rate, reactivations, review velocity — aggregates only."""
    return RetentionService(db, audit).dashboard(days=days)


@router.get("/recall-status/{patient_uuid}")
def recall_status(
    patient_uuid: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    row = db.execute(
        select(Appointment)
        .where(Appointment.patient_id == patient_uuid, Appointment.recall_status.is_not(None))
        .order_by(Appointment.completed_at.desc())
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="No recall history for that patient")
    audit.log_read(str(patient_uuid), "recall_status", user)
    return {
        "patient_uuid": str(patient_uuid), "stage": row.recall_stage, "status": row.recall_status,
        "next_action_date": row.recall_next_action_date.isoformat() + "Z" if row.recall_next_action_date else None,
        "last_visit_at": row.completed_at.isoformat() + "Z" if row.completed_at else None,
    }


@router.post("/trigger-recall", response_model=ActionResult)
def trigger_recall(
    payload: TriggerRecallRequest,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    """Manually re-run the recall drip for a patient's most recent completed visit."""
    row = db.execute(
        select(Appointment).where(
            Appointment.patient_id == payload.patient_uuid, Appointment.status == AppointmentStatus.COMPLETED,
        ).order_by(Appointment.completed_at.desc())
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="No completed appointment for that patient")
    service = RetentionService(db, audit)
    if payload.force or row.recall_status is None:
        service._start_hygiene_recall(row, row.patient)  # noqa: SLF001 - intentional staff override
        db.commit()
    result = service.process_recall(row.id)
    return ActionResult(status=result.get("status", "ok"), data=result)


@router.get("/patients-at-risk", response_model=list[PatientAtRisk])
def patients_at_risk(
    days: Optional[int] = Query(default=None, ge=1, le=730),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """Active hygiene-recall patients overdue past N days (default 180)."""
    return RetentionService(db, audit).patients_at_risk(days=days, limit=limit)


@router.post("/trigger-review", response_model=ActionResult)
def trigger_review(
    payload: TriggerReviewRequest,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    service = RetentionService(db, audit)
    appointment_id = payload.appointment_id
    if appointment_id is None:
        if payload.patient_uuid is None:
            raise HTTPException(status_code=400, detail="appointment_id or patient_uuid is required")
        appointment = db.execute(
            select(Appointment).where(
                Appointment.patient_id == payload.patient_uuid, Appointment.status == AppointmentStatus.COMPLETED,
            ).order_by(Appointment.scheduled_for.desc()).limit(1)
        ).scalars().first()
        if appointment is None:
            raise HTTPException(status_code=404, detail="No completed appointment for that patient")
        appointment_id = appointment.id

    result = service.process_review(appointment_id)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result.get("status", "ok"), data=result)


@router.post("/review-received", response_model=ActionResult)
def review_received(
    payload: ReviewReceived,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    """Manually record a review (e.g. a practice manager pasting one in)."""
    appointment = db.get(Appointment, payload.appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    appointment.review_received_at = appointment.review_received_at or utcnow()
    appointment.review_star_rating = payload.star_rating
    appointment.encrypted_review_text = payload.review_text
    appointment.google_review_id = payload.review_id
    db.commit()
    draft = RetentionService(db, audit).draft_review_response(
        review_text=payload.review_text, star_rating=payload.star_rating, patient_uuid=str(appointment.patient_id)
    )
    return ActionResult(status="recorded", data={"draft_response": draft, "requires_dentist_approval": True})


@router.post("/review-approve/{appointment_id}", response_model=ActionResult)
def approve_review(
    appointment_id: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    """Post the dentist-approved review response live to Business Profile."""
    result = RetentionService(db, audit).approve_review_response(appointment_id)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Appointment not found")
    return ActionResult(status=result.get("status", "ok"), data=result)


@router.get("/events/{patient_uuid}")
def patient_timeline(
    patient_uuid: UUID,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    from app.models.retention_event import RetentionEvent

    audit.log_read(str(patient_uuid), "retention_timeline", user)
    rows = db.execute(
        select(RetentionEvent).where(RetentionEvent.patient_id == patient_uuid)
        .order_by(RetentionEvent.created_at.desc()).limit(limit)
    ).scalars().all()
    return [
        {
            "event_type": row.event_type, "channel": row.channel,
            "appointment_id": str(row.appointment_id) if row.appointment_id else None,
            "treatment_plan_id": str(row.treatment_plan_id) if row.treatment_plan_id else None,
            "metadata": row.event_metadata, "created_at": row.created_at.isoformat() + "Z",
        }
        for row in rows
    ]


@router.get("/config")
def retention_config(user: str = Depends(require_staff)) -> dict:
    return {
        "hygiene_recall_days": settings.hygiene_recall_days,
        "review_request_delay_days": settings.review_request_delay_days,
        "review_recheck_days": settings.review_recheck_days,
        "practice_google_review_url": settings.practice_google_review_url,
        "practice_booking_url": settings.practice_booking_url,
    }
