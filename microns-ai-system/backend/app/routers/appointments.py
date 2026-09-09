"""Appointment CRUD and the queries the n8n cron workflows read.

Mounted at ``/api/appointments`` because that is the path Workflow A and
Workflow B call (``/api/appointments/upcoming``, ``/api/appointments/no-shows``).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit, require_staff
from app.models.appointment import Appointment, AppointmentStatus
from app.schemas import (
    ActionResult,
    AppointmentCreate,
    AppointmentOut,
    AppointmentStatusUpdate,
)
from app.services.booking_service import get_booking_service
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services import pricing_service
from app.services.patient_service import get_or_create_patient
from app.services.retention_service import RetentionService
from app.utils import to_utc_naive, utcnow

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


@router.get("/upcoming")
def upcoming(
    within_hours: int = Query(default=48, ge=1, le=336),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """Appointments due in the next N hours, de-identified.

    Consumed by Workflow A. The ``due_24h_reminder`` / ``due_2h_reminder``
    booleans are precomputed here so the workflow's IF nodes stay trivial and
    the reminder-window logic lives in one testable place.
    """
    return RetentionService(db, audit).upcoming_appointments(within_hours=within_hours)


@router.get("/no-shows")
def no_shows(
    days: int = Query(default=1, ge=1, le=90),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[dict]:
    """Recent no-shows, de-identified. Consumed by Workflow B."""
    return RetentionService(db, audit).recent_no_shows(days=days)


@router.get("/availability")
def availability(
    service: str = Query(default="consultation"),
    days_ahead: int = Query(default=7, ge=1, le=60),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
    user: str = Depends(require_staff),
) -> dict:
    """Open slots from the configured booking system."""
    slots = get_booking_service(db).get_available_slots(
        service=service, days_ahead=days_ahead, limit=limit
    )
    return {
        "service": service,
        "provider": get_booking_service(db).name,
        "slots": [slot.to_dict() for slot in slots],
    }


@router.post("", response_model=AppointmentOut, status_code=201)
def create_appointment(
    payload: AppointmentCreate,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> AppointmentOut:
    patient, _ = get_or_create_patient(
        db,
        phone=payload.phone,
        name=payload.name,
        email=payload.email,
        sms_consent=payload.sms_consent,
        audit=audit,
        user_id=user,
    )
    appointment = Appointment(
        patient_id=patient.id,
        service=payload.service,
        provider=payload.provider,
        scheduled_for=to_utc_naive(payload.scheduled_for),
        duration_minutes=payload.duration_minutes,
        status=AppointmentStatus.CONFIRMED,
        source=payload.source,
        encrypted_notes=payload.notes,
    )
    # A price supplied by staff is evidence; the price list is only a
    # fallback, and never overwrites what a human actually typed.
    if payload.price_cents is not None:
        pricing_service.mark_recorded_price(appointment, payload.price_cents)
    else:
        pricing_service.apply_expected_price(appointment)
    db.add(appointment)
    db.flush()
    audit.log_write(str(patient.id), DataCategory.APPOINTMENT, user, details={"source": payload.source})
    db.commit()
    return _to_out(appointment)


@router.get("/{appointment_id}", response_model=AppointmentOut)
def get_appointment(
    appointment_id: UUID,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> AppointmentOut:
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    audit.log_read(str(appointment.patient_id), DataCategory.APPOINTMENT, user)
    return _to_out(appointment)


@router.patch("/{appointment_id}/status", response_model=ActionResult)
def update_status(
    appointment_id: UUID,
    payload: AppointmentStatusUpdate,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> ActionResult:
    """Move an appointment through its lifecycle.

    ``completed`` is routed through the retention service so the review clock
    starts and the patient's visit history updates — the same path the
    ``/webhooks/treatment-completed`` hook takes.
    """
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")

    service = RetentionService(db, audit)
    if payload.status == AppointmentStatus.COMPLETED:
        result = service.treatment_completed(appointment.id)
        return ActionResult(status="completed", data=result)

    previous = appointment.status
    appointment.status = payload.status
    if payload.status == AppointmentStatus.CANCELLED:
        appointment.cancelled_at = utcnow()
    if payload.status == AppointmentStatus.NO_SHOW:
        service.record_event(
            event_type="no_show",
            patient_id=appointment.patient_id,
            appointment_id=appointment.id,
            channel="system",
            metadata={"marked_by": user, "reason": payload.reason},
        )
    audit.log_access(
        "update",
        str(appointment.patient_id),
        DataCategory.APPOINTMENT,
        user,
        details={"from": previous, "to": payload.status},
    )
    db.commit()
    return ActionResult(
        status="updated", data={"appointment_id": str(appointment.id), "status": appointment.status}
    )


@router.get("")
def list_appointments(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> list[AppointmentOut]:
    query = select(Appointment).order_by(Appointment.scheduled_for.desc()).limit(limit)
    if status_filter:
        query = query.where(Appointment.status == status_filter)
    rows = db.execute(query).scalars().all()
    audit.log_read(None, DataCategory.APPOINTMENT, user, details={"count": len(rows)})
    return [_to_out(row) for row in rows]


def _to_out(appointment: Appointment) -> AppointmentOut:
    return AppointmentOut(
        appointment_id=appointment.id,
        patient_uuid=appointment.patient_id,
        service=appointment.service,
        provider=appointment.provider,
        scheduled_for=appointment.scheduled_for,
        duration_minutes=appointment.duration_minutes,
        status=appointment.status,
        source=appointment.source,
    )
