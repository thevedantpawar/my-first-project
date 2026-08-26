"""AI voice agent — VAPI webhook handling.

Call flow:

1. VAPI posts to ``/voice/inbound`` when a call connects. We look the caller up
   by phone fingerprint, open a :class:`VoiceCall` record, and hand VAPI the
   assistant overrides (practice name, first name if we know them).
2. During the call VAPI posts tool calls to ``/voice/action`` — check
   availability, book, reschedule, cancel, quote a price, answer a logistical
   question, or escalate a dental emergency.
3. ``/voice/end`` stores the transcript (encrypted), duration and outcome.

**The agent does not triage medical urgency by itself.** Anything that sounds
like a real emergency (knocked-out tooth, severe pain/swelling, facial
trauma) routes to :meth:`VoiceService.request_emergency_escalation`, which
alerts the on-call dentist immediately rather than letting the model decide
how urgent something is. Anything clinical that isn't an emergency (drug
interactions, "is this safe given my condition") routes to
:meth:`VoiceService.request_callback`, a 2-hour provider callback promise —
the same hard boundary the after-hours SMS flow (Module 4) enforces.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import timedelta
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.patient import Patient
from app.models.voice_call import VoiceCall, VoiceCallOutcome
from app.services import sms_service as templates
from app.services.deidentify import DeidentificationContext
from app.services.encryption import get_encryption_service, normalise_identifier
from app.services.gmail_service import get_gmail_service
from app.services.google_calendar_service import CalendarEventParser, GoogleCalendarService
from app.services.hipaa_audit import AuditAction, DataCategory, HIPAAAuditLogger
from app.services.llm import get_llm
from app.services.notifier import notify_emergency_escalated, notify_voice_handoff
from app.services.patient_service import find_by_phone, get_or_create_patient
from app.services.sms_service import SMSService
from app.utils import format_appointment_time, is_after_hours, parse_datetime, to_practice_time, utcnow

logger = logging.getLogger(__name__)

DEFAULT_PRICE_LIST: dict[str, dict[str, Any]] = {
    "cleaning": {"label": "Cleaning (Prophylaxis)", "from": 100, "unit": "", "typical": "$100-$200"},
    "filling": {"label": "Filling", "from": 150, "unit": "per tooth", "typical": "$150-$400 per tooth"},
    "crown": {"label": "Crown", "from": 900, "unit": "", "typical": "$900-$1,500"},
    "whitening": {"label": "Whitening", "from": 300, "unit": "", "typical": "$300-$600"},
    "invisalign": {"label": "Invisalign", "from": 3500, "unit": "full treatment", "typical": "$3,500-$7,000"},
    "implants": {"label": "Implant", "from": 3000, "unit": "per tooth", "typical": "$3,000-$5,000 per tooth"},
    "extraction": {"label": "Extraction", "from": 150, "unit": "per tooth", "typical": "$150-$450 per tooth"},
    "root_canal": {"label": "Root Canal", "from": 700, "unit": "per tooth", "typical": "$700-$1,500 per tooth"},
    "veneers": {"label": "Veneers", "from": 900, "unit": "per tooth", "typical": "$900-$2,500 per tooth"},
    "consultation": {"label": "Consultation / new patient exam", "from": 0, "unit": "", "typical": "Complimentary"},
}

#: Answers that mean "this is not a phone triage decision" — escalate now.
_EMERGENCY_PHRASES = (
    "knocked out", "knocked-out", "tooth fell out", "avulsed",
    "severe pain", "can't stop bleeding", "cant stop bleeding", "won't stop bleeding",
    "swelling", "swollen face", "facial swelling", "broken jaw", "trauma", "hit in the face",
)


class VoiceService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)
        self.calendar = GoogleCalendarService()

    # ------------------------------------------------------------------ #
    # Call lifecycle
    # ------------------------------------------------------------------ #
    def handle_inbound(self, payload: dict[str, Any]) -> dict[str, Any]:
        call = _extract_call(payload)
        call_id = call.get("id")
        caller_number = _extract_caller_number(call)

        patient = find_by_phone(self.db, caller_number) if caller_number else None
        first_name = _first_name(patient)

        record = VoiceCall(
            vapi_call_id=call_id,
            patient_id=patient.id if patient else None,
            encrypted_caller_number=caller_number,
            caller_fingerprint=get_encryption_service().fingerprint(caller_number),
            outcome=VoiceCallOutcome.IN_PROGRESS,
            summary={"direction": call.get("type") or "inboundPhoneCall", "after_hours": is_after_hours()},
        )
        self.db.add(record)
        self.db.flush()

        self.audit.log_call(
            str(patient.id) if patient else None, action=AuditAction.CALL_STARTED, call_id=call_id
        )
        self.db.commit()

        greeting = (
            f"Hi {first_name}, thanks for calling {settings.practice_name}! This is Sarah. "
            "How can I help you today?"
            if first_name
            else f"Thanks for calling {settings.practice_name}! This is Sarah. How can I help you today?"
        )

        return {
            "call_record_id": record.id,
            "known_patient": patient is not None,
            "greeting": greeting,
            "assistant_overrides": {
                "variableValues": {
                    "PRACTICE_NAME": settings.practice_name,
                    "PRACTICE_PHONE": settings.practice_phone or "",
                    "PATIENT_FIRST_NAME": first_name or "",
                    "IS_RETURNING_PATIENT": "yes" if patient else "no",
                    "BOOKING_URL": settings.practice_booking_url,
                    "AFTER_HOURS": "yes" if is_after_hours() else "no",
                },
                "firstMessage": greeting,
            },
        }

    def handle_end(
        self, *, call_id: Optional[str], transcript: Optional[str], duration_seconds: Optional[int],
        outcome: Optional[str], ended_reason: Optional[str], summary: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        record = self._find_call(call_id)
        if record is None:
            record = VoiceCall(vapi_call_id=call_id, outcome=VoiceCallOutcome.ABANDONED)
            self.db.add(record)
            self.db.flush()

        record.transcript = transcript
        record.call_duration = duration_seconds
        record.ended_at = utcnow()
        record.ended_reason = ended_reason
        if outcome:
            record.outcome = outcome
        elif record.outcome == VoiceCallOutcome.IN_PROGRESS:
            record.outcome = _infer_outcome(ended_reason, duration_seconds)

        merged = dict(record.summary or {})
        merged.update(summary or {})
        record.summary = merged

        self.audit.log_call(
            str(record.patient_id) if record.patient_id else None,
            action=AuditAction.CALL_ENDED, call_id=call_id, outcome=record.outcome,
        )
        self.db.commit()
        return {"call_record_id": str(record.id), "outcome": record.outcome, "duration_seconds": record.call_duration}

    # ------------------------------------------------------------------ #
    # Tool actions
    # ------------------------------------------------------------------ #
    def handle_action(self, *, action: str, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        handlers = {
            "check_availability": self.check_availability,
            "book_appointment": self.book_appointment,
            "reschedule_appointment": self.reschedule_appointment,
            "cancel_appointment": self.cancel_appointment,
            "lookup_appointment": self.lookup_appointment,
            "get_pricing": self.get_pricing,
            "answer_faq": self.answer_faq,
            "request_emergency_escalation": self.request_emergency_escalation,
            "request_callback": self.request_callback,
        }
        handler = handlers.get(action)
        if handler is None:
            logger.warning("Unknown voice action requested: %s", action)
            return {
                "result": {"error": "unknown_action", "action": action},
                "speech": "Let me get someone from the team to help with that.",
            }
        return handler(parameters=parameters, call_id=call_id)

    # -- availability / booking (Google Calendar is the source of truth) -- #
    def check_availability(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        service = _normalise_service(parameters.get("service"))
        days_ahead = int(parameters.get("days_ahead") or 7)
        limit = int(parameters.get("limit") or 3)

        slots = self._available_slots(days_ahead=days_ahead, limit=limit)
        if not slots:
            return {
                "result": {"slots": []},
                "speech": "I'm not seeing anything open in that window — would you like the front desk to call you with more options?",
            }
        spoken = " or ".join(format_appointment_time(slot) for slot in slots[:3])
        return {
            "result": {"service": service, "slots": [s.isoformat() + "Z" for s in slots]},
            "speech": f"I have {spoken}. Which of those works best?",
        }

    def _available_slots(self, *, days_ahead: int, limit: int):
        """Practice hours minus what's already on the primary Google Calendar."""
        from datetime import datetime

        duration = timedelta(minutes=settings.appointment_slot_minutes)
        busy = self.calendar.search_future_events(
            settings.google_primary_calendar_id, time_max=utcnow() + timedelta(days=days_ahead), max_results=250
        )
        windows = []
        for event in busy:
            start = parse_datetime(event.get("start", {}).get("dateTime"))
            end = parse_datetime(event.get("end", {}).get("dateTime"))
            if start and end:
                windows.append((start, end))

        slots = []
        cursor = _next_slot_boundary(utcnow() + timedelta(hours=1), settings.appointment_slot_minutes)
        horizon = utcnow() + timedelta(days=days_ahead)
        guard = 0
        while cursor < horizon and len(slots) < limit and guard < 5000:
            guard += 1
            local = to_practice_time(cursor)
            close_hour = (
                settings.practice_close_hour_fri if local.weekday() == 4 else settings.practice_close_hour_mon_thu
            )
            within_hours = settings.practice_open_hour <= local.hour < close_hour
            is_weekday = local.weekday() < 5
            end = cursor + duration
            if within_hours and is_weekday and not any(cursor < w_end and end > w_start for w_start, w_end in windows):
                slots.append(cursor)
                cursor = end
            elif not within_hours or not is_weekday:
                cursor = cursor + timedelta(hours=1)
            else:
                cursor = end
        return slots

    def book_appointment(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        service = _normalise_service(parameters.get("service"))
        start = parse_datetime(parameters.get("slot_start") or parameters.get("start"))
        phone = parameters.get("patient_phone") or parameters.get("phone")
        name = parameters.get("patient_name") or parameters.get("name")

        record = self._find_call(call_id)
        if not phone and record is not None:
            phone = record.encrypted_caller_number

        if start is None:
            return {"result": {"error": "missing_slot"}, "speech": "Sorry — which day and time would you like?"}
        if not phone:
            return {"result": {"error": "missing_phone"}, "speech": "What's the best phone number for your confirmation text?"}

        patient, _ = get_or_create_patient(
            self.db, phone=normalise_identifier(phone), name=name, sms_consent=True,
            audit=self.audit, user_id="voice-agent",
        )

        google_event_id = None
        if settings.google_primary_calendar_id:
            description = CalendarEventParser.build_appointment_description(
                patient_id=str(patient.id), patient_name=name or patient.name or "Patient",
                phone=patient.phone, service=service,
            )
            event = self.calendar.create_event(
                settings.google_primary_calendar_id,
                summary=f"{DEFAULT_PRICE_LIST.get(service, {}).get('label', service)} - {name or 'Patient'}",
                description=description, start=start, end=start + timedelta(minutes=settings.appointment_slot_minutes),
            )
            google_event_id = event.get("id")

        appointment = Appointment(
            patient_id=patient.id, google_event_id=google_event_id,
            google_calendar_id=settings.google_primary_calendar_id if google_event_id else None,
            service=service, scheduled_for=start, duration_minutes=settings.appointment_slot_minutes,
            status=AppointmentStatus.PENDING, source=AppointmentSource.VOICE,
        )
        self.db.add(appointment)
        self.db.flush()

        if record is not None:
            record.patient_id = patient.id
            record.appointment_id = appointment.id
            record.outcome = VoiceCallOutcome.BOOKED

        self.sms.send(
            to=patient.phone, body=templates.booking_confirmation(service=service, when=start, first_name=_first_name(patient)),
            template="booking_confirmation", patient_uuid=str(patient.id), sms_consent=patient.sms_consent,
        )
        self.audit.log_write(str(patient.id), DataCategory.APPOINTMENT, "voice-agent", details={"source": "voice"})

        from app.services.treatment_plan_service import TreatmentPlanService

        TreatmentPlanService(self.db, self.audit).handle_booking(patient_id=patient.id)
        self.db.commit()

        return {
            "result": {
                "appointment_id": str(appointment.id), "status": appointment.status,
                "scheduled_for": start.isoformat() + "Z", "service": service,
            },
            "speech": (
                f"Great, you're all set for {DEFAULT_PRICE_LIST.get(service, {}).get('label', service)} on "
                f"{format_appointment_time(start)}. You'll receive a confirmation text shortly."
            ),
        }

    def lookup_appointment(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        patient = self._patient_for_call(parameters, call_id)
        if patient is None:
            return {"result": {"appointments": []}, "speech": "I couldn't find anything under that number — what name is it booked under?"}
        rows = self.db.execute(
            select(Appointment).where(
                Appointment.patient_id == patient.id, Appointment.status.in_(AppointmentStatus.ACTIVE),
                Appointment.scheduled_for >= utcnow(),
            ).order_by(Appointment.scheduled_for).limit(5)
        ).scalars().all()
        self.audit.log_read(str(patient.id), DataCategory.APPOINTMENT, "voice-agent")
        if not rows:
            return {"result": {"appointments": []}, "speech": "I don't see an upcoming appointment for you — would you like to book one?"}
        nearest = rows[0]
        return {
            "result": {"appointments": [{"appointment_id": str(r.id), "service": r.service, "scheduled_for": r.scheduled_for.isoformat() + "Z", "status": r.status} for r in rows]},
            "speech": f"I have you down for {format_appointment_time(nearest.scheduled_for)}.",
        }

    def reschedule_appointment(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        appointment = self._resolve_appointment(parameters, call_id)
        new_start = parse_datetime(parameters.get("new_slot_start") or parameters.get("slot_start"))
        if appointment is None:
            return {"result": {"error": "not_found"}, "speech": "I couldn't find that appointment — what name is it under?"}
        if new_start is None:
            return {"result": {"error": "missing_slot"}, "speech": "What day and time would you like to move it to?"}

        appointment.scheduled_for = new_start
        appointment.status = AppointmentStatus.PENDING
        if appointment.google_event_id and appointment.google_calendar_id:
            self.calendar.update_event(
                appointment.google_calendar_id, appointment.google_event_id, start=new_start,
                end=new_start + timedelta(minutes=appointment.duration_minutes),
            )

        patient = appointment.patient
        self.sms.send(
            to=patient.phone if patient else None,
            body=templates.reschedule_confirmation(service=appointment.service, when=new_start, first_name=_first_name(patient)),
            template="reschedule_confirmation", patient_uuid=str(appointment.patient_id),
            sms_consent=patient.sms_consent if patient else None,
        )
        record = self._find_call(call_id)
        if record is not None:
            record.outcome = VoiceCallOutcome.RESCHEDULED
            record.appointment_id = appointment.id
        self.audit.log_access("update", str(appointment.patient_id), DataCategory.APPOINTMENT, "voice-agent", details={"action": "reschedule"})
        self.db.commit()
        return {
            "result": {"appointment_id": str(appointment.id), "scheduled_for": new_start.isoformat() + "Z"},
            "speech": f"Done — I've moved you to {format_appointment_time(new_start)}. You'll get a text confirming it.",
        }

    def cancel_appointment(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        appointment = self._resolve_appointment(parameters, call_id)
        if appointment is None:
            return {"result": {"error": "not_found"}, "speech": "I couldn't find that appointment — what name is it under?"}
        appointment.status = AppointmentStatus.CANCELLED
        appointment.cancelled_at = utcnow()
        if appointment.google_event_id and appointment.google_calendar_id:
            self.calendar.delete_event(appointment.google_calendar_id, appointment.google_event_id)
        record = self._find_call(call_id)
        if record is not None:
            record.outcome = VoiceCallOutcome.CANCELLED
        self.audit.log_access("update", str(appointment.patient_id), DataCategory.APPOINTMENT, "voice-agent", details={"action": "cancel"})
        self.db.commit()
        return {
            "result": {"appointment_id": str(appointment.id), "status": appointment.status},
            "speech": "That's cancelled for you. Would you like to rebook now, or shall I send you the booking link?",
        }

    # -- information ------------------------------------------------------ #
    def get_pricing(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        service = _normalise_service(parameters.get("service"))
        prices = load_price_list()
        entry = prices.get(service)
        if entry is None:
            return {
                "result": {"prices": prices},
                "speech": "Pricing depends on the treatment plan — which treatment were you asking about?",
            }
        return {
            "result": {"service": service, **entry},
            "speech": f"{entry['label']} is typically {entry['typical']}. The exact price is confirmed at your exam.",
        }

    def answer_faq(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        question = str(parameters.get("question") or "").strip()
        if not question:
            return {"result": {}, "speech": "Sorry, what would you like to know?"}

        if any(phrase in question.lower() for phrase in _EMERGENCY_PHRASES):
            return self.request_emergency_escalation(parameters={"reason": question, **parameters}, call_id=call_id)

        record = self._find_call(call_id)
        patient = record.patient if record is not None else None
        context = DeidentificationContext(patient_uuid=str(patient.id) if patient else None)
        context.register_name(patient.name if patient else None)
        safe_question = context.deidentify(question)

        answer = get_llm().complete_text(
            system=load_prompt("insurance-faq-agent.txt"), user=safe_question, purpose="voice_faq",
            temperature=0.3, max_tokens=180, audit=self.audit, patient_uuid=str(patient.id) if patient else None,
        )
        if not answer:
            return {
                "result": {"answered": False},
                "speech": "That's a good question — let me have someone from the team call you back with the details. What's the best number?",
            }
        return {"result": {"answered": True}, "speech": context.reidentify(answer)}

    # -- escalation --------------------------------------------------------- #
    def request_emergency_escalation(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        """A real dental emergency (knocked-out tooth, severe trauma, uncontrolled
        bleeding) — alert the on-call dentist now, not a routed callback."""
        reason = str(parameters.get("reason") or "dental_emergency")
        callback_number = parameters.get("callback_number") or parameters.get("phone")

        record = self._find_call(call_id)
        patient = None
        if callback_number:
            patient, _ = get_or_create_patient(
                self.db, phone=normalise_identifier(str(callback_number)), name=parameters.get("patient_name"),
                sms_consent=True, audit=self.audit, user_id="voice-agent",
            )
        elif record is not None:
            patient = record.patient

        if record is not None:
            record.outcome = VoiceCallOutcome.EMERGENCY_ESCALATED
            if patient is not None:
                record.patient_id = patient.id
            summary = dict(record.summary or {})
            summary["escalation_reason"] = reason
            record.summary = summary

        if patient is not None:
            self.sms.send(
                to=patient.phone, body=templates.emergency_reassurance_urgent(),
                template="emergency_reassurance_urgent", patient_uuid=str(patient.id), sms_consent=patient.sms_consent,
            )
        try:
            get_gmail_service().send_message(
                to=settings.on_call_dentist_email or settings.front_desk_email or "",
                subject=f"\U0001F6A8 EMERGENCY CALLBACK: {patient.name if patient else 'Unknown caller'}",
                body=f"URGENT dental emergency reported by phone. Please call back within 15 minutes. Context: {reason}",
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("Emergency escalation email skipped: %s", type(exc).__name__)

        self.audit.log_access(
            "write", str(patient.id) if patient else None, DataCategory.TRANSCRIPT, "voice-agent",
            details={"escalation_reason": reason},
        )
        self.db.commit()
        notify_emergency_escalated(call_record_id=record.id if record else None, patient_uuid=patient.id if patient else None)
        return {
            "result": {"escalated": True, "reason": reason},
            "speech": (
                "This sounds like it needs immediate attention. I've alerted our on-call dentist and "
                "they'll call you back within 15 minutes. If this is life-threatening, please call 911."
            ),
        }

    def request_callback(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        """A clinical question that isn't an emergency — promise a 2-hour callback."""
        reason = str(parameters.get("reason") or "clinical_question")
        callback_number = parameters.get("callback_number") or parameters.get("phone")
        priority = str(parameters.get("priority") or "normal")

        record = self._find_call(call_id)
        patient = None
        if callback_number:
            patient, _ = get_or_create_patient(
                self.db, phone=normalise_identifier(str(callback_number)), name=parameters.get("patient_name"),
                sms_consent=True, audit=self.audit, user_id="voice-agent",
            )
        elif record is not None:
            patient = record.patient

        if record is not None:
            record.outcome = VoiceCallOutcome.CALLBACK_REQUESTED
            if patient is not None:
                record.patient_id = patient.id
            summary = dict(record.summary or {})
            summary["handoff_reason"] = reason
            summary["priority"] = priority
            record.summary = summary

        if patient is not None:
            self.sms.send(
                to=patient.phone,
                body=(
                    f"Thanks for reaching out to {settings.practice_name}. That's a question for our "
                    "dentist — they'll call you back within 2 hours."
                ),
                template="callback_ack", patient_uuid=str(patient.id), sms_consent=patient.sms_consent,
            )

        self.audit.log_access(
            "write", str(patient.id) if patient else None, DataCategory.TRANSCRIPT, "voice-agent",
            details={"handoff_reason": reason, "priority": priority},
        )
        self.db.commit()
        notify_voice_handoff(call_record_id=record.id if record else None, patient_uuid=patient.id if patient else None, reason=reason, priority=priority)
        return {
            "result": {"callback_logged": True, "reason": reason},
            "speech": "That's an important question for our dentist. I'll have them call you back within 2 hours.",
        }

    # ------------------------------------------------------------------ #
    def _find_call(self, call_id: Optional[str]) -> Optional[VoiceCall]:
        if not call_id:
            return None
        return self.db.execute(
            select(VoiceCall).where(VoiceCall.vapi_call_id == call_id).order_by(VoiceCall.created_at.desc())
        ).scalars().first()

    def _patient_for_call(self, parameters: dict[str, Any], call_id: Optional[str]) -> Optional[Patient]:
        phone = parameters.get("patient_phone") or parameters.get("phone")
        if phone:
            return find_by_phone(self.db, str(phone))
        record = self._find_call(call_id)
        if record is None:
            return None
        if record.patient is not None:
            return record.patient
        return find_by_phone(self.db, record.encrypted_caller_number)

    def _resolve_appointment(self, parameters: dict[str, Any], call_id: Optional[str]) -> Optional[Appointment]:
        appointment_id = parameters.get("appointment_id")
        if appointment_id:
            try:
                appointment = self.db.get(Appointment, appointment_id)
            except Exception:
                appointment = None
            if appointment is not None:
                return appointment

        patient = self._patient_for_call(parameters, call_id)
        if patient is None:
            return None
        return self.db.execute(
            select(Appointment).where(
                Appointment.patient_id == patient.id, Appointment.status.in_(AppointmentStatus.ACTIVE),
                Appointment.scheduled_for >= utcnow(),
            ).order_by(Appointment.scheduled_for)
        ).scalars().first()


# ---------------------------------------------------------------------- #
# Payload helpers — VAPI nests its webhook body differently per event type.
# ---------------------------------------------------------------------- #
def _extract_call(payload: dict[str, Any]) -> dict[str, Any]:
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    for candidate in (message.get("call"), payload.get("call"), payload):
        if isinstance(candidate, dict) and ("id" in candidate or "customer" in candidate):
            return candidate
    return {}


def _extract_caller_number(call: dict[str, Any]) -> Optional[str]:
    customer = call.get("customer") if isinstance(call.get("customer"), dict) else {}
    number = customer.get("number") or call.get("from") or call.get("phoneNumber")
    if isinstance(number, dict):
        number = number.get("number")
    return str(number) if number else None


def extract_action(payload: dict[str, Any]) -> tuple[Optional[str], dict[str, Any], Optional[str]]:
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    call_id = _extract_call(payload).get("id")

    tool_calls = message.get("toolCalls") or message.get("toolCallList") or payload.get("toolCalls")
    if isinstance(tool_calls, list) and tool_calls:
        first = tool_calls[0] or {}
        function = first.get("function") or first
        name = function.get("name")
        arguments = function.get("arguments")
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except (TypeError, ValueError):
                arguments = {}
        return name, (arguments or {}), call_id

    function_call = message.get("functionCall") or payload.get("functionCall")
    if isinstance(function_call, dict):
        arguments = function_call.get("parameters") or function_call.get("arguments") or {}
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except (TypeError, ValueError):
                arguments = {}
        return function_call.get("name"), arguments, call_id

    action = payload.get("action") or message.get("action")
    parameters = payload.get("parameters") or message.get("parameters") or {}
    return action, (parameters if isinstance(parameters, dict) else {}), call_id


def _normalise_service(value: Any) -> str:
    text = str(value or "consultation").strip().lower()
    aliases = {
        "cleaning": "cleaning", "clean": "cleaning", "prophylaxis": "cleaning",
        "filling": "filling", "fillings": "filling", "cavity": "filling",
        "crown": "crown",
        "whitening": "whitening",
        "invisalign": "invisalign", "braces": "invisalign", "clear aligners": "invisalign",
        "implant": "implants", "implants": "implants",
        "extraction": "extraction", "pull": "extraction", "wisdom teeth": "extraction",
        "root canal": "root_canal", "endodontic": "root_canal",
        "veneer": "veneers", "veneers": "veneers",
        "consult": "consultation", "consultation": "consultation", "exam": "consultation", "new patient": "consultation",
    }
    for alias, canonical in aliases.items():
        if alias in text:
            return canonical
    return text or "consultation"


def _first_name(patient: Optional[Patient]) -> Optional[str]:
    if patient is None or not patient.name:
        return None
    return str(patient.name).strip().split()[0]


def _infer_outcome(ended_reason: Optional[str], duration: Optional[int]) -> str:
    reason = (ended_reason or "").lower()
    if "voicemail" in reason:
        return VoiceCallOutcome.VOICEMAIL
    if "transfer" in reason or "forwarded" in reason:
        return VoiceCallOutcome.TRANSFERRED
    if duration is not None and duration < 10:
        return VoiceCallOutcome.ABANDONED
    return VoiceCallOutcome.FAQ


def _next_slot_boundary(moment, minutes: int):
    moment = moment.replace(second=0, microsecond=0)
    remainder = moment.minute % minutes
    if remainder:
        moment += timedelta(minutes=minutes - remainder)
    return moment


def _prompt_dir() -> Path:
    if settings.voice_prompt_dir:
        return Path(settings.voice_prompt_dir)
    # Repo layout: backend/app/services/… -> ../../../voice-agent/system-prompts
    return Path(__file__).resolve().parents[3] / "voice-agent" / "system-prompts"


def load_prompt(filename: str) -> str:
    path = _prompt_dir() / filename
    try:
        return (
            path.read_text(encoding="utf-8")
            .replace("[PRACTICE_NAME]", settings.practice_name)
            .replace("{{PRACTICE_NAME}}", settings.practice_name)
        )
    except OSError:
        logger.warning("Voice prompt not found at %s — using a built-in fallback", path)
        return (
            f"You are Sarah, the assistant for {settings.practice_name}, a dental practice. Answer "
            "logistical questions in two sentences or fewer. Never give clinical advice or "
            "diagnoses — for anything clinical, say a dentist will call back within 2 hours, and "
            "for a real emergency, escalate immediately instead of waiting."
        )


def load_price_list() -> dict[str, dict[str, Any]]:
    path = os.environ.get("PRICE_LIST_PATH") or str(_prompt_dir().parent / "price-list.json")
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else DEFAULT_PRICE_LIST
    except (OSError, ValueError):
        return DEFAULT_PRICE_LIST


__all__ = ["VoiceService", "extract_action", "load_price_list", "load_prompt"]
