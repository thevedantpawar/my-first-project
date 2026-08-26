"""Module 4 — after-hours emergency capture (Twilio + Google Calendar).

A missed call outside office hours gets an immediate SMS offering
URGENT / BOOK / INFO, and an on-call calendar alert. The patient's reply is
matched back to that pending case and routed: URGENT emails the on-call
dentist and reassures the patient, BOOK fetches the next Calendly emergency
slot and books it, INFO sends office hours. An unknown caller is deliberately
**not** auto-texted — identity can't be confirmed from a phone number alone,
and texting an unverified number is a bigger risk than a missed callback.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.emergency_call import EmergencyCall, EmergencyCallOutcome
from app.services import sms_service as templates
from app.services.encryption import get_encryption_service, normalise_identifier
from app.services.gmail_service import get_gmail_service
from app.services.google_calendar_service import CalendarEventParser, GoogleCalendarService
from app.services.google_contacts_service import get_contacts_service
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.patient_service import find_by_phone, get_or_create_patient
from app.services.sms_service import SMSService
from app.utils import is_after_hours, utcnow

logger = logging.getLogger(__name__)

try:  # pragma: no cover
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore[assignment]


class EmergencyCaptureService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)
        self.calendar = GoogleCalendarService()

    # ------------------------------------------------------------------ #
    # A call rang and was not answered
    # ------------------------------------------------------------------ #
    def handle_missed_call(self, *, caller_number: str, missed: bool = True) -> dict[str, Any]:
        if not missed or not is_after_hours():
            return {"status": "ignored", "reason": "not_an_after_hours_missed_call"}

        patient = find_by_phone(self.db, caller_number)
        if patient is None:
            # Best-effort Contacts lookup before giving up — a caller might be
            # a known patient whose record predates this system.
            try:
                contact = get_contacts_service().find_by_phone(caller_number)
            except Exception:  # pragma: no cover - Google not configured yet
                contact = None
            if contact is None:
                self._log_unknown_caller(caller_number)
                return {"status": "logged", "reason": "unknown_caller_not_texted"}
            names = contact.get("names", [{}])
            display_name = names[0].get("displayName") if names else None
            patient, _ = get_or_create_patient(
                self.db, phone=normalise_identifier(caller_number), name=display_name,
                audit=self.audit, user_id="google-contacts",
            )

        record = EmergencyCall(
            patient_id=patient.id,
            phone_fingerprint=get_encryption_service().fingerprint(caller_number),
            outcome=EmergencyCallOutcome.PENDING_REPLY,
        )
        self.db.add(record)
        self.db.flush()

        first_name = (patient.name or "").split(" ")[0] if patient.name else None
        self.sms.send(
            to=patient.phone, body=templates.emergency_missed_call(first_name=first_name),
            template="emergency_missed_call", patient_uuid=str(patient.id), sms_consent=patient.sms_consent,
        )

        if settings.google_on_call_calendar_id:
            event = self.calendar.create_event(
                settings.google_on_call_calendar_id,
                summary=f"\U0001F6A8 URGENT: {first_name or 'Unknown'} | awaiting reply",
                description=(
                    f"PATIENT_ID: {patient.id}\nPHONE: {patient.phone}\n"
                    f"Patient called at {utcnow().isoformat()}. Awaiting reply (URGENT/BOOK/INFO)."
                ),
                start=utcnow(), end=utcnow() + timedelta(minutes=15), reminders_minutes=[0],
            )
            record.on_call_calendar_id = settings.google_on_call_calendar_id
            record.on_call_event_id = event.get("id")

        self.audit.log_write(str(patient.id), DataCategory.APPOINTMENT, "twilio", details={"module": "emergency_capture"})
        self.db.commit()
        return {"status": "texted", "emergency_call_id": str(record.id)}

    def _log_unknown_caller(self, caller_number: str) -> None:
        record = EmergencyCall(
            phone_fingerprint=get_encryption_service().fingerprint(caller_number),
            outcome=EmergencyCallOutcome.UNRECOGNIZED_REPLY,
            resolved_at=utcnow(),
        )
        self.db.add(record)
        self.audit.log_access(
            "write", None, DataCategory.PHONE, "twilio",
            details={"module": "emergency_capture", "outcome": "unknown_caller_no_action"},
        )
        self.db.commit()

    # ------------------------------------------------------------------ #
    # The patient replies
    # ------------------------------------------------------------------ #
    def handle_reply(self, *, from_phone: str, body: str) -> dict[str, Any]:
        keyword = _parse_keyword(body)
        fingerprint = get_encryption_service().fingerprint(from_phone)
        record = self.db.execute(
            select(EmergencyCall)
            .where(EmergencyCall.phone_fingerprint == fingerprint, EmergencyCall.outcome == EmergencyCallOutcome.PENDING_REPLY)
            .order_by(EmergencyCall.received_at.desc())
        ).scalars().first()

        if record is None:
            return {"status": "ignored", "reason": "no_pending_emergency_for_this_number"}

        patient = record.patient
        if keyword == "URGENT":
            return self._handle_urgent(record, patient)
        if keyword == "BOOK":
            return self._handle_book(record, patient)
        if keyword == "INFO":
            return self._handle_info(record, patient)

        record.outcome = EmergencyCallOutcome.UNRECOGNIZED_REPLY
        record.reply_keyword = keyword
        record.resolved_at = utcnow()
        self.db.commit()
        return {"status": "ignored", "reason": "reply_not_urgent_book_or_info"}

    def _handle_urgent(self, record: EmergencyCall, patient) -> dict[str, Any]:
        try:
            get_gmail_service().send_message(
                to=settings.on_call_dentist_email or settings.front_desk_email or "",
                subject=f"\U0001F6A8 EMERGENCY CALLBACK: {patient.name if patient else 'Unknown'} | {patient.phone if patient else ''}",
                body=(
                    f"URGENT dental emergency. Patient replied URGENT to the missed-call text. "
                    "Please call back within 15 minutes."
                ),
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("Emergency URGENT email skipped: %s", type(exc).__name__)

        self.sms.send(
            to=patient.phone if patient else None, body=templates.emergency_reassurance_urgent(),
            template="emergency_reassurance_urgent", patient_uuid=str(patient.id) if patient else None,
            sms_consent=patient.sms_consent if patient else None,
        )
        record.outcome = EmergencyCallOutcome.URGENT_ESCALATED
        record.reply_keyword = "URGENT"
        record.resolved_at = utcnow()
        self.db.commit()
        return {"status": "escalated"}

    def _handle_book(self, record: EmergencyCall, patient) -> dict[str, Any]:
        slot = self._next_emergency_slot()
        if slot is None:
            self.sms.send(
                to=patient.phone if patient else None,
                body="We're working on finding you an emergency slot — our front desk will text you shortly.",
                template="emergency_slot_offer", patient_uuid=str(patient.id) if patient else None,
                sms_consent=patient.sms_consent if patient else None,
            )
            return {"status": "no_slot_available"}

        from app.utils import format_appointment_time

        self.sms.send(
            to=patient.phone if patient else None,
            body=templates.emergency_slot_offer(when_text=format_appointment_time(slot["start"]), address=settings.practice_address),
            template="emergency_slot_offer", patient_uuid=str(patient.id) if patient else None,
            sms_consent=patient.sms_consent if patient else None,
        )

        google_event_id = None
        if patient is not None and settings.google_primary_calendar_id:
            description = CalendarEventParser.build_appointment_description(
                patient_id=str(patient.id), patient_name=patient.name or "Patient",
                phone=patient.phone, service="Emergency",
            )
            event = self.calendar.create_event(
                settings.google_primary_calendar_id,
                summary=f"EMERGENCY: {patient.name or 'Patient'} | {patient.phone}",
                description=description, start=slot["start"], end=slot["start"] + timedelta(minutes=settings.appointment_slot_minutes),
            )
            google_event_id = event.get("id")

        appointment = None
        if patient is not None:
            appointment = Appointment(
                patient_id=patient.id, google_event_id=google_event_id,
                google_calendar_id=settings.google_primary_calendar_id if google_event_id else None,
                service="emergency", scheduled_for=slot["start"], duration_minutes=settings.appointment_slot_minutes,
                status=AppointmentStatus.CONFIRMED, source=AppointmentSource.EMERGENCY,
            )
            self.db.add(appointment)
            self.db.flush()
            record.emergency_appointment_id = appointment.id

        try:
            get_gmail_service().create_draft(
                to=settings.front_desk_email or "",
                subject=f"Emergency appointment booked: {patient.name if patient else 'Unknown'}",
                body=f"Emergency slot booked for {patient.name if patient else 'unknown'} at {slot['start']}. Please prep the chart.",
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("Emergency booking confirmation draft skipped: %s", type(exc).__name__)

        record.outcome = EmergencyCallOutcome.BOOKED
        record.reply_keyword = "BOOK"
        record.resolved_at = utcnow()
        self.db.commit()
        return {"status": "booked", "appointment_id": str(appointment.id) if appointment else None}

    def _handle_info(self, record: EmergencyCall, patient) -> dict[str, Any]:
        self.sms.send(
            to=patient.phone if patient else None, body=templates.emergency_office_hours(),
            template="emergency_office_hours", patient_uuid=str(patient.id) if patient else None,
            sms_consent=patient.sms_consent if patient else None,
        )
        record.outcome = EmergencyCallOutcome.INFO_SENT
        record.reply_keyword = "INFO"
        record.resolved_at = utcnow()
        self.db.commit()
        return {"status": "info_sent"}

    def _next_emergency_slot(self) -> Optional[dict[str, Any]]:
        if httpx is None or not settings.calendly_enabled or not settings.calendly_emergency_event_type_uri:
            return None
        try:
            response = httpx.get(
                f"{settings.calendly_emergency_event_type_uri}/available_times",
                headers={"Authorization": f"Bearer {settings.calendly_api_key}"},
                params={"start_time": utcnow().isoformat() + "Z", "end_time": (utcnow() + timedelta(days=2)).isoformat() + "Z"},
                timeout=10.0,
            )
            response.raise_for_status()
            collection = response.json().get("collection", [])
            if not collection:
                return None
            from app.utils import parse_datetime

            start = parse_datetime(collection[0].get("start_time"))
            return {"start": start, "scheduling_url": collection[0].get("scheduling_url")} if start else None
        except Exception as exc:
            logger.error("Calendly emergency-slot fetch failed: %s", type(exc).__name__)
            return None


def _parse_keyword(body: str) -> str:
    text = (body or "").strip().upper()
    if "URGENT" in text:
        return "URGENT"
    if "BOOK" in text:
        return "BOOK"
    if "INFO" in text:
        return "INFO"
    return "OTHER"


__all__ = ["EmergencyCaptureService"]
