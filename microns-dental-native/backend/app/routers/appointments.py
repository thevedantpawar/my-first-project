"""Appointment CRUD and availability."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_audit, require_staff
from app.models.appointment import Appointment, AppointmentStatus
from app.schemas import ActionResult, AppointmentCreate, AppointmentOut, AppointmentStatusUpdate
from app.services.google_calendar_service import CalendarEventParser, GoogleCalendarService
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.patient_service import get_or_create_patient
from app.services.retention_service import RetentionService
from app.services.treatment_plan_service import TreatmentPlanService
from app.services.voice_service import VoiceService
from app.utils import to_utc_naive, utcnow

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


@router.get("/availability")
def availability(
    days_ahead: int = Query(default=7, ge=1, le=60),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> dict:
    """Open slots derived from practice hours minus the primary Google Calendar."""
    slots = VoiceService(db, audit)._available_slots(days_ahead=days_ahead, limit=limit)  # noqa: SLF001
    return {"provider": "google_calendar", "slots": [s.isoformat() + "Z" for s in slots]}


@router.post("", response_model=AppointmentOut, status_code=201)
def create_appointment(
    payload: AppointmentCreate,
    db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> AppointmentOut:
    patient, _ = get_or_create_patient(
        db, phone=payload.phone, name=payload.name, email=payload.email, sms_consent=payload.sms_consent,
        audit=audit, user_id=user,
    )
    google_event_id = payload.google_event_id
    if google_event_id is None:
        from app.config import settings

        if settings.google_primary_calendar_id:
            description = CalendarEventParser.build_appointment_description(
                patient_id=str(patient.id), patient_name=patient.name or "Patient", phone=patient.phone,
                email=patient.email, service=payload.service, provider=payload.provider,
            )
            event = GoogleCalendarService().create_event(
                settings.google_primary_calendar_id,
                summary=f"{payload.service} - {patient.name or 'Patient'}", description=description,
                start=to_utc_naive(payload.scheduled_for), end=to_utc_naive(payload.scheduled_for) + timedelta(minutes=payload.duration_minutes),
            )
            google_event_id = event.get("id")

    appointment = Appointment(
        patient_id=patient.id, google_event_id=google_event_id,
        service=payload.service, provider=payload.provider, scheduled_for=to_utc_naive(payload.scheduled_for),
        duration_minutes=payload.duration_minutes, status=AppointmentStatus.CONFIRMED, source=payload.source,
        encrypted_notes=payload.notes,
    )
    db.add(appointment)
    db.flush()
    audit.log_write(str(patient.id), DataCategory.APPOINTMENT, user, details={"source": payload.source})
    db.commit()
    return _to_out(appointment)


@router.get("/{appointment_id}", response_model=AppointmentOut)
def get_appointment(
    appointment_id: UUID, db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit),
    user: str = Depends(require_staff),
) -> AppointmentOut:
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    audit.log_read(str(appointment.patient_id), DataCategory.APPOINTMENT, user)
    return _to_out(appointment)


@router.patch("/{appointment_id}/status", response_model=ActionResult)
def update_status(
    appointment_id: UUID, payload: AppointmentStatusUpdate, db: Session = Depends(get_db),
    audit: HIPAAAuditLogger = Depends(get_audit), user: str = Depends(require_staff),
) -> ActionResult:
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")

    previous = appointment.status
    appointment.status = payload.status
    if payload.status == AppointmentStatus.CANCELLED:
        appointment.cancelled_at = utcnow()
        if appointment.google_event_id and appointment.google_calendar_id:
            GoogleCalendarService().delete_event(appointment.google_calendar_id, appointment.google_event_id)
    if payload.status == AppointmentStatus.CONFIRMED:
        TreatmentPlanService(db, audit).handle_booking(patient_id=appointment.patient_id)
    audit.log_access("update", str(appointment.patient_id), DataCategory.APPOINTMENT, user, details={"from": previous, "to": payload.status})
    db.commit()
    return ActionResult(status="updated", data={"appointment_id": str(appointment.id), "status": appointment.status})


@router.get("")
def list_appointments(
    status_filter: str | None = Query(default=None, alias="status"), limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db), audit: HIPAAAuditLogger = Depends(get_audit), user: str = Depends(require_staff),
) -> list[AppointmentOut]:
    query = select(Appointment).order_by(Appointment.scheduled_for.desc()).limit(limit)
    if status_filter:
        query = query.where(Appointment.status == status_filter)
    rows = db.execute(query).scalars().all()
    audit.log_read(None, DataCategory.APPOINTMENT, user, details={"count": len(rows)})
    return [_to_out(row) for row in rows]


def _to_out(appointment: Appointment) -> AppointmentOut:
    return AppointmentOut(
        appointment_id=appointment.id, patient_uuid=appointment.patient_id, service=appointment.service,
        provider=appointment.provider, scheduled_for=appointment.scheduled_for,
        duration_minutes=appointment.duration_minutes, status=appointment.status, source=appointment.source,
    )
