"""Module 6 — insurance verification assistant.

A daily job pulls tomorrow's new-patient appointments that have insurance on
file, drafts a benefits-verification request to the insurance coordinator,
and — once they reply — an AI agent with a structured-output contract
extracts the numbers a coordinator wrote in free text, texts the patient
their copay, and updates the appointment.
"""

from __future__ import annotations

import logging
import re
from datetime import timedelta
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment
from app.models.patient import Patient
from app.services.deidentify import DeidentificationContext
from app.services.gmail_service import get_gmail_service
from app.services.google_calendar_service import CalendarEventParser, GoogleCalendarService
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.llm import get_llm
from app.services.patient_service import get_or_create_patient
from app.services.sms_service import SMSService, insurance_verified_copay
from app.utils import format_appointment_time, mask_name, utcnow

logger = logging.getLogger(__name__)

_JSON_SCHEMA_EXAMPLE = (
    '{ "annual_max_remaining_cents": 120000, "deductible_met": true, '
    '"deductible_remaining_cents": 0, "coverage_d0120_pct": 100, "coverage_d1110_pct": 100, '
    '"coverage_d4341_pct": 80, "coverage_d2740_pct": 50, "waiting_periods": false, '
    '"estimated_copay_cents": 4500 }'
)


class InsuranceService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)
        self.calendar = GoogleCalendarService()

    # ------------------------------------------------------------------ #
    # Daily 4pm check
    # ------------------------------------------------------------------ #
    def request_verifications_for_tomorrow(self) -> list[dict[str, Any]]:
        """Find tomorrow's new-patient appointments with insurance on file
        and draft a verification request for each."""
        tomorrow_start = (utcnow() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow_end = tomorrow_start + timedelta(days=1)

        events = self.calendar.search_future_events(
            settings.google_primary_calendar_id, time_min=tomorrow_start, time_max=tomorrow_end, max_results=100
        )

        results = []
        for event in events:
            fields = CalendarEventParser.parse_appointment_description(event.get("description"))
            is_new_patient = "new patient" in (fields.get("service") or "").lower()
            if not is_new_patient or not fields.get("insurance") or not fields.get("phone"):
                continue
            results.append(self._request_verification_for_event(event, fields))
        return results

    def _request_verification_for_event(self, event: dict, fields: dict) -> dict[str, Any]:
        patient, _ = get_or_create_patient(
            self.db,
            phone=fields["phone"],
            name=fields.get("patient"),
            member_id=fields.get("member_id"),
            insurance_provider=fields.get("insurance"),
            audit=self.audit,
            user_id="google-calendar",
        )

        from app.utils import parse_datetime

        scheduled_for = parse_datetime(event.get("start", {}).get("dateTime")) or utcnow()
        appointment = self.db.execute(
            select(Appointment).where(Appointment.google_event_id == event.get("id"))
        ).scalars().first()
        if appointment is None:
            appointment = Appointment(
                patient_id=patient.id,
                google_event_id=event.get("id"),
                google_calendar_id=settings.google_primary_calendar_id,
                service=fields.get("service") or "new patient exam",
                provider=fields.get("provider"),
                scheduled_for=scheduled_for,
                is_new_patient=True,
                source="staff",
            )
            self.db.add(appointment)

        appointment.insurance_provider = fields.get("insurance")
        appointment.encrypted_member_id = fields.get("member_id")
        appointment.insurance_verification_status = "pending"
        self.db.flush()

        subject = (
            f"[VERIFY-{appointment.id}] VERIFY: {mask_name(patient.name)} | {fields.get('insurance')} | "
            f"Member ID: {fields.get('member_id') or 'on file'} | Appt: {format_appointment_time(scheduled_for)}"
        )
        body = (
            f"Please verify benefits for tomorrow's new patient appointment:\n\n"
            f"Patient: {mask_name(patient.name)}\n"
            f"Insurance: {fields.get('insurance')}\n"
            f"Member ID: {fields.get('member_id') or 'on file'}\n"
            f"Appointment: {format_appointment_time(scheduled_for)}\n\n"
            "Please verify:\n"
            "- Annual maximum remaining\n"
            "- Deductible met (Y/N) and amount remaining\n"
            "- D0120 (Periodic Oral Evaluation) % coverage\n"
            "- D1110 (Prophylaxis - Adult) % coverage\n"
            "- D4341 (Scaling & Root Planing) % coverage\n"
            "- D2740 (Crown - Porcelain/Ceramic) % coverage\n"
            "- Waiting periods for major services (Y/N)\n"
            "- Estimated copay for this visit\n\n"
            "Please reply to this email with the verification results by 6:00 PM today."
        )
        get_gmail_service().create_draft(
            to=settings.insurance_coordinator_email or "", subject=subject, body=body
        )
        self.audit.log_gmail_draft(str(patient.id), purpose="insurance_verification_request")
        self._log_event("insurance_request_sent", patient_id=patient.id, appointment_id=appointment.id)
        self.db.commit()
        return {"appointment_id": str(appointment.id), "status": "requested"}

    # ------------------------------------------------------------------ #
    # Coordinator's reply
    # ------------------------------------------------------------------ #
    def parse_verify_tag(self, subject: str) -> Optional[UUID]:
        match = re.search(r"\[VERIFY-([0-9a-fA-F-]{36})\]", subject or "")
        if not match:
            return None
        try:
            return UUID(match.group(1))
        except ValueError:
            return None

    def process_reply(self, *, appointment_id: UUID, reply_text: str) -> dict[str, Any]:
        appointment = self.db.get(Appointment, appointment_id)
        if appointment is None:
            return {"status": "not_found"}
        if appointment.insurance_verification_status != "pending":
            return {"status": "skipped", "reason": "stale_or_already_verified"}

        patient = self.db.get(Patient, appointment.patient_id)
        context = DeidentificationContext(patient_uuid=str(patient.id) if patient else None)
        safe_reply = context.deidentify(reply_text)

        parsed = get_llm().complete_json(
            system=(
                "Extract structured dental insurance verification data from the insurance "
                "coordinator's email reply. Return every field in this JSON shape (use null for "
                "anything not mentioned): "
                f"{_JSON_SCHEMA_EXAMPLE}. All *_cents fields are integers in US cents "
                "(e.g. $45.00 -> 4500). *_pct fields are integer percentages 0-100."
            ),
            user=safe_reply,
            purpose="insurance_reply_extraction",
            temperature=0.0,
            max_tokens=300,
            audit=self.audit,
            patient_uuid=str(patient.id) if patient else None,
        )
        if not parsed:
            parsed = _fallback_parse(reply_text)

        appointment.insurance_verification_status = "verified"
        appointment.insurance_verified_at = utcnow()
        appointment.insurance_annual_max_remaining_cents = parsed.get("annual_max_remaining_cents")
        appointment.insurance_deductible_met = parsed.get("deductible_met")
        appointment.insurance_deductible_remaining_cents = parsed.get("deductible_remaining_cents")
        appointment.insurance_waiting_periods = parsed.get("waiting_periods")
        appointment.insurance_copay_cents = parsed.get("estimated_copay_cents")
        appointment.insurance_coverage_d0120_pct = parsed.get("coverage_d0120_pct")
        appointment.insurance_coverage_d1110_pct = parsed.get("coverage_d1110_pct")
        appointment.insurance_coverage_d4341_pct = parsed.get("coverage_d4341_pct")
        appointment.insurance_coverage_d2740_pct = parsed.get("coverage_d2740_pct")

        copay_cents = parsed.get("estimated_copay_cents") or 0
        result = self.sms.send(
            to=patient.phone if patient else None,
            body=insurance_verified_copay(
                first_name=_first_name(patient),
                insurance_provider=appointment.insurance_provider or "insurance",
                copay_display=f"${copay_cents / 100:,.2f}",
                when_text=format_appointment_time(appointment.scheduled_for),
            ),
            template="insurance_verified_copay",
            patient_uuid=str(appointment.patient_id),
            sms_consent=patient.sms_consent if patient else None,
        )

        if appointment.google_event_id and appointment.google_calendar_id:
            description = CalendarEventParser.build_appointment_description(
                patient_id=str(appointment.patient_id),
                patient_name=patient.name if patient else "Patient",
                phone=patient.phone if patient else "",
                service=appointment.service,
                provider=appointment.provider,
                insurance=appointment.insurance_provider,
                verified=True,
                copay_cents=copay_cents,
            )
            self.calendar.update_event(
                appointment.google_calendar_id, appointment.google_event_id, description=description
            )

        self._log_event(
            "insurance_verified", patient_id=appointment.patient_id, appointment_id=appointment.id,
            metadata={"sms_status": result.status},
        )
        self.db.commit()
        return {"status": "verified", "sms_status": result.status, "parsed": parsed}

    def _log_event(self, event_type: str, *, patient_id, appointment_id, metadata: Optional[dict] = None) -> None:
        from app.models.retention_event import RetentionEvent

        self.db.add(
            RetentionEvent(
                event_type=event_type, patient_id=patient_id, appointment_id=appointment_id,
                event_metadata=metadata or {},
            )
        )
        self.db.flush()


def _fallback_parse(text: str) -> dict[str, Any]:
    """Cheap regex fallback when OpenAI is unavailable — better than nothing."""
    def _dollars(pattern: str) -> Optional[int]:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            return None
        try:
            return round(float(match.group(1).replace(",", "")) * 100)
        except ValueError:
            return None

    return {
        "annual_max_remaining_cents": _dollars(r"annual max\w*.*?\$?([\d,]+\.?\d*)"),
        "deductible_met": bool(re.search(r"deductible\s*met[:\s]*y", text, re.IGNORECASE)),
        "deductible_remaining_cents": _dollars(r"deductible.*?remaining.*?\$?([\d,]+\.?\d*)"),
        "coverage_d0120_pct": None,
        "coverage_d1110_pct": None,
        "coverage_d4341_pct": None,
        "coverage_d2740_pct": None,
        "waiting_periods": bool(re.search(r"waiting period\w*[:\s]*y", text, re.IGNORECASE)),
        "estimated_copay_cents": _dollars(r"copay.*?\$?([\d,]+\.?\d*)"),
    }


def _first_name(patient: Optional[Patient]) -> Optional[str]:
    if patient is None or not patient.name:
        return None
    return str(patient.name).strip().split()[0]


__all__ = ["InsuranceService"]
