"""AI voice agent — VAPI webhook handling.

Call flow:

1. VAPI posts to ``/voice/inbound`` when a call connects. We look the caller up
   by phone fingerprint, open a :class:`VoiceCall` record, and hand VAPI the
   assistant overrides (clinic name, first name if we know them).
2. During the call VAPI posts tool calls to ``/voice/action`` — check
   availability, book, reschedule, cancel, quote a price, take a callback.
3. ``/voice/end`` stores the transcript (encrypted), duration and outcome.

**The agent does not answer clinical questions.** Contraindications, pregnancy,
medications and side effects route to :meth:`VoiceService.request_callback`,
which promises a provider call within two hours and fires the handoff workflow.
That is a product rule as much as a compliance one: an LLM improvising about
whether Botox is safe on a blood thinner is the failure mode that ends a
clinic.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.patient import Patient
from app.models.voice_call import VoiceCall, VoiceCallOutcome
from app.services import sms_service as templates
from app.services.booking_service import get_booking_service
from app.services.deidentify import DeidentificationContext
from app.services.encryption import get_encryption_service, normalise_identifier
from app.services.hipaa_audit import AuditAction, DataCategory, HIPAAAuditLogger
from app.services.llm import get_llm
from app.services.notifier import notify_voice_handoff
from app.services.patient_service import find_by_phone, get_or_create_patient
from app.services.sms_service import SMSService
from app.utils import format_appointment_time, parse_datetime, utcnow

logger = logging.getLogger(__name__)

DEFAULT_PRICE_LIST: dict[str, dict[str, Any]] = {
    "botox": {"label": "Botox", "from": 12, "unit": "per unit", "typical": "$240-$480 per area"},
    "fillers": {"label": "Dermal fillers", "from": 650, "unit": "per syringe", "typical": "$650-$900 per syringe"},
    "laser": {"label": "Laser hair removal", "from": 120, "unit": "per session", "typical": "$120-$400 per session"},
    "facial": {"label": "Signature facial", "from": 150, "unit": "per session", "typical": "$150-$250"},
    "peel": {"label": "Chemical peel", "from": 175, "unit": "per session", "typical": "$175-$350"},
    "consultation": {"label": "Consultation", "from": 0, "unit": "", "typical": "Complimentary"},
}


class VoiceService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)

    # ------------------------------------------------------------------ #
    # Call lifecycle
    # ------------------------------------------------------------------ #
    def handle_inbound(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Call started. Open a record and return assistant overrides."""
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
            summary={"direction": call.get("type") or "inboundPhoneCall"},
        )
        self.db.add(record)
        self.db.flush()

        self.audit.log_call(
            str(patient.id) if patient else None, action=AuditAction.CALL_STARTED, call_id=call_id
        )
        self.db.commit()

        greeting = (
            f"Hi {first_name}, thanks for calling {settings.clinic_name}! This is Bella. "
            "How can I help you today?"
            if first_name
            else f"Thanks for calling {settings.clinic_name}! This is Bella. How can I help you today?"
        )

        return {
            "call_record_id": record.id,
            "known_patient": patient is not None,
            "greeting": greeting,
            # VAPI merges these into the assistant at call time.
            "assistant_overrides": {
                "variableValues": {
                    "CLINIC_NAME": settings.clinic_name,
                    "CLINIC_PHONE": settings.clinic_phone or "",
                    "PATIENT_FIRST_NAME": first_name or "",
                    "IS_RETURNING_PATIENT": "yes" if patient else "no",
                    "BOOKING_URL": settings.clinic_booking_url,
                },
                "firstMessage": greeting,
            },
        }

    def handle_end(
        self,
        *,
        call_id: Optional[str],
        transcript: Optional[str],
        duration_seconds: Optional[int],
        outcome: Optional[str],
        ended_reason: Optional[str],
        summary: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Call ended. Persist the transcript (encrypted) and the outcome."""
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
            action=AuditAction.CALL_ENDED,
            call_id=call_id,
            outcome=record.outcome,
        )
        self.db.commit()
        return {
            "call_record_id": str(record.id),
            "outcome": record.outcome,
            "duration_seconds": record.call_duration,
        }

    # ------------------------------------------------------------------ #
    # Tool actions
    # ------------------------------------------------------------------ #
    def handle_action(
        self, *, action: str, parameters: dict[str, Any], call_id: Optional[str]
    ) -> dict[str, Any]:
        """Dispatch a VAPI tool call.

        Returns ``{"result": ..., "speech": ...}``. ``speech`` is a suggested
        utterance; VAPI may paraphrase it, so it never carries information the
        agent must say verbatim.
        """
        handlers = {
            "check_availability": self.check_availability,
            "book_appointment": self.book_appointment,
            "reschedule_appointment": self.reschedule_appointment,
            "cancel_appointment": self.cancel_appointment,
            "get_pricing": self.get_pricing,
            "answer_faq": self.answer_faq,
            "request_callback": self.request_callback,
            "lookup_appointment": self.lookup_appointment,
        }
        handler = handlers.get(action)
        if handler is None:
            logger.warning("Unknown voice action requested: %s", action)
            return {
                "result": {"error": "unknown_action", "action": action},
                "speech": "Let me get someone from the team to help with that.",
            }
        return handler(parameters=parameters, call_id=call_id)

    # -- availability / booking ---------------------------------------- #
    def check_availability(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        service = _normalise_service(parameters.get("service"))
        days_ahead = int(parameters.get("days_ahead") or 7)
        limit = int(parameters.get("limit") or 3)

        slots = get_booking_service(self.db).get_available_slots(
            service=service, days_ahead=days_ahead, limit=limit
        )
        if not slots:
            return {
                "result": {"slots": []},
                "speech": (
                    "I'm not seeing anything open in that window — would you like me to have "
                    "the front desk call you with more options?"
                ),
            }

        spoken = " or ".join(slot.label for slot in slots[:3])
        return {
            "result": {"service": service, "slots": [slot.to_dict() for slot in slots]},
            "speech": f"I have {spoken}. Which of those works best?",
        }

    def book_appointment(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        """Create a pending appointment and text a confirmation.

        Booked as ``pending`` on purpose: it holds the slot immediately, and
        front desk confirms. A voice agent mishearing a date should not put a
        confirmed appointment on the calendar.
        """
        service = _normalise_service(parameters.get("service"))
        start = parse_datetime(parameters.get("slot_start") or parameters.get("start"))
        phone = parameters.get("patient_phone") or parameters.get("phone")
        name = parameters.get("patient_name") or parameters.get("name")

        record = self._find_call(call_id)
        if not phone and record is not None:
            phone = record.encrypted_caller_number

        if start is None:
            return {
                "result": {"error": "missing_slot"},
                "speech": "Sorry — which day and time would you like?",
            }
        if not phone:
            return {
                "result": {"error": "missing_phone"},
                "speech": "What's the best phone number for your confirmation text?",
            }

        patient, _ = get_or_create_patient(
            self.db,
            phone=normalise_identifier(phone),
            name=name,
            sms_consent=True,
            audit=self.audit,
            user_id="voice-agent",
        )

        booking = get_booking_service(self.db)
        reference = booking.create_booking(
            service=service,
            start=start,
            patient_name=name or patient.name,
            patient_phone=patient.phone,
            patient_email=patient.email,
        )

        appointment = Appointment(
            patient_id=patient.id,
            service=service,
            scheduled_for=start,
            duration_minutes=settings.appointment_slot_minutes,
            status=AppointmentStatus.PENDING,
            source=AppointmentSource.VOICE,
            external_id=reference.external_id,
            extra={"booked_by": "voice_agent", "vapi_call_id": call_id},
        )
        self.db.add(appointment)
        self.db.flush()

        if record is not None:
            record.patient_id = patient.id
            record.appointment_id = appointment.id
            record.outcome = VoiceCallOutcome.BOOKED

        self.sms.send(
            to=patient.phone,
            body=templates.booking_confirmation(
                service=service, when=start, first_name=_first_name(patient)
            ),
            template="booking_confirmation",
            patient_uuid=str(patient.id),
            sms_consent=patient.sms_consent,
        )
        self.audit.log_write(
            str(patient.id), DataCategory.APPOINTMENT, "voice-agent", details={"source": "voice"}
        )
        self.db.commit()

        return {
            "result": {
                "appointment_id": str(appointment.id),
                "status": appointment.status,
                "scheduled_for": start.isoformat() + "Z",
                "service": service,
            },
            "speech": (
                f"Great, you're all set for {DEFAULT_PRICE_LIST.get(service, {}).get('label', service)} "
                f"on {format_appointment_time(start)}. You'll receive a confirmation text shortly."
            ),
        }

    def lookup_appointment(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        patient = self._patient_for_call(parameters, call_id)
        if patient is None:
            return {
                "result": {"appointments": []},
                "speech": "I couldn't find anything under that number — what name is it booked under?",
            }
        rows = (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.patient_id == patient.id,
                    Appointment.status.in_(AppointmentStatus.ACTIVE),
                    Appointment.scheduled_for >= utcnow(),
                )
                .order_by(Appointment.scheduled_for)
                .limit(5)
            )
            .scalars()
            .all()
        )
        self.audit.log_read(str(patient.id), DataCategory.APPOINTMENT, "voice-agent")
        if not rows:
            return {
                "result": {"appointments": []},
                "speech": "I don't see an upcoming appointment for you — would you like to book one?",
            }
        nearest = rows[0]
        return {
            "result": {
                "appointments": [
                    {
                        "appointment_id": str(row.id),
                        "service": row.service,
                        "scheduled_for": row.scheduled_for.isoformat() + "Z",
                        "status": row.status,
                    }
                    for row in rows
                ]
            },
            "speech": f"I have you down for {format_appointment_time(nearest.scheduled_for)}.",
        }

    def reschedule_appointment(
        self, *, parameters: dict[str, Any], call_id: Optional[str]
    ) -> dict[str, Any]:
        appointment = self._resolve_appointment(parameters, call_id)
        new_start = parse_datetime(parameters.get("new_slot_start") or parameters.get("slot_start"))
        if appointment is None:
            return {
                "result": {"error": "not_found"},
                "speech": "I couldn't find that appointment — what name is it under?",
            }
        if new_start is None:
            return {
                "result": {"error": "missing_slot"},
                "speech": "What day and time would you like to move it to?",
            }

        old_start = appointment.scheduled_for
        appointment.scheduled_for = new_start
        appointment.status = AppointmentStatus.PENDING
        # A moved appointment gets a fresh reminder cycle.
        appointment.reminder_24h_sent_at = None
        appointment.reminder_2h_sent_at = None

        if appointment.external_id:
            get_booking_service(self.db).reschedule_booking(appointment.external_id, new_start)

        patient = appointment.patient
        self.sms.send(
            to=patient.phone if patient else None,
            body=templates.booking_confirmation(
                service=appointment.service, when=new_start, first_name=_first_name(patient)
            ),
            template="reschedule_confirmation",
            patient_uuid=str(appointment.patient_id),
            sms_consent=patient.sms_consent if patient else None,
        )
        record = self._find_call(call_id)
        if record is not None:
            record.outcome = VoiceCallOutcome.RESCHEDULED
            record.appointment_id = appointment.id
        self.audit.log_access(
            "update",
            str(appointment.patient_id),
            DataCategory.APPOINTMENT,
            "voice-agent",
            details={"action": "reschedule"},
        )
        self.db.commit()
        return {
            "result": {
                "appointment_id": str(appointment.id),
                "previous": old_start.isoformat() + "Z",
                "scheduled_for": new_start.isoformat() + "Z",
            },
            "speech": (
                f"Done — I've moved you to {format_appointment_time(new_start)}. "
                "You'll get a text confirming it."
            ),
        }

    def cancel_appointment(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        appointment = self._resolve_appointment(parameters, call_id)
        if appointment is None:
            return {
                "result": {"error": "not_found"},
                "speech": "I couldn't find that appointment — what name is it under?",
            }
        appointment.status = AppointmentStatus.CANCELLED
        appointment.cancelled_at = utcnow()
        record = self._find_call(call_id)
        if record is not None:
            record.outcome = VoiceCallOutcome.CANCELLED
        self.audit.log_access(
            "update",
            str(appointment.patient_id),
            DataCategory.APPOINTMENT,
            "voice-agent",
            details={"action": "cancel"},
        )
        self.db.commit()
        return {
            "result": {"appointment_id": str(appointment.id), "status": appointment.status},
            "speech": (
                "That's cancelled for you. Would you like to rebook now, or shall I send you "
                "the booking link?"
            ),
        }

    # -- information ---------------------------------------------------- #
    def get_pricing(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        service = _normalise_service(parameters.get("service"))
        prices = load_price_list()
        entry = prices.get(service)
        if entry is None:
            return {
                "result": {"prices": prices},
                "speech": (
                    "Pricing depends on the treatment plan — I can have the team go through "
                    "the options with you. Which treatment were you asking about?"
                ),
            }
        return {
            "result": {"service": service, **entry},
            "speech": (
                f"{entry['label']} is typically {entry['typical']}. The exact price depends on "
                "your consultation — that part's complimentary."
            ),
        }

    def answer_faq(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        """Answer a non-clinical question from the FAQ prompt.

        If the question turns out to be clinical, this refuses and routes to a
        callback rather than answering.
        """
        question = str(parameters.get("question") or "").strip()
        if not question:
            return {"result": {}, "speech": "Sorry, what would you like to know?"}

        from app.services.lead_service import MEDICAL_QUESTION_PATTERNS

        if MEDICAL_QUESTION_PATTERNS.search(question):
            return self.request_callback(
                parameters={"reason": "medical_question", **parameters}, call_id=call_id
            )

        record = self._find_call(call_id)
        patient = record.patient if record is not None else None
        context = DeidentificationContext(patient_uuid=str(patient.id) if patient else None)
        context.register_name(patient.name if patient else None)
        safe_question = context.deidentify(question)

        answer = get_llm().complete_text(
            system=load_faq_prompt(),
            user=safe_question,
            purpose="voice_faq",
            temperature=0.3,
            max_tokens=180,
            audit=self.audit,
            patient_uuid=str(patient.id) if patient else None,
        )
        if not answer:
            return {
                "result": {"answered": False},
                "speech": (
                    "That's a good question — let me have someone from the team call you back "
                    "with the details. What's the best number?"
                ),
            }
        return {"result": {"answered": True}, "speech": context.reidentify(answer)}

    def request_callback(self, *, parameters: dict[str, Any], call_id: Optional[str]) -> dict[str, Any]:
        """Promise a provider callback and fire the handoff workflow."""
        reason = str(parameters.get("reason") or "medical_question")
        callback_number = parameters.get("callback_number") or parameters.get("phone")
        priority = str(parameters.get("priority") or "normal")

        record = self._find_call(call_id)
        patient = None
        if callback_number:
            patient, _ = get_or_create_patient(
                self.db,
                phone=normalise_identifier(str(callback_number)),
                name=parameters.get("patient_name"),
                sms_consent=True,
                audit=self.audit,
                user_id="voice-agent",
            )
        elif record is not None:
            patient = record.patient

        if record is not None:
            record.outcome = VoiceCallOutcome.CALLBACK_REQUESTED
            if patient is not None:
                record.patient_id = patient.id
            summary = dict(record.summary or {})
            # The question itself is PHI and stays in the encrypted transcript.
            summary["handoff_reason"] = reason
            summary["priority"] = priority
            record.summary = summary

        if patient is not None:
            self.sms.send(
                to=patient.phone,
                body=templates.medical_callback_ack(),
                template="callback_ack",
                patient_uuid=str(patient.id),
                sms_consent=patient.sms_consent,
            )

        self.audit.log_access(
            "write",
            str(patient.id) if patient else None,
            DataCategory.TRANSCRIPT,
            "voice-agent",
            details={"handoff_reason": reason, "priority": priority},
        )
        self.db.commit()

        notify_voice_handoff(
            call_record_id=record.id if record else None,
            patient_uuid=patient.id if patient else None,
            reason=reason,
            priority=priority,
        )
        return {
            "result": {"callback_logged": True, "reason": reason},
            "speech": (
                "That's an important question for our medical provider. I'll have them call you "
                "back within 2 hours."
            ),
        }

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _find_call(self, call_id: Optional[str]) -> Optional[VoiceCall]:
        if not call_id:
            return None
        return (
            self.db.execute(
                select(VoiceCall)
                .where(VoiceCall.vapi_call_id == call_id)
                .order_by(VoiceCall.created_at.desc())
            )
            .scalars()
            .first()
        )

    def _patient_for_call(
        self, parameters: dict[str, Any], call_id: Optional[str]
    ) -> Optional[Patient]:
        phone = parameters.get("patient_phone") or parameters.get("phone")
        if phone:
            return find_by_phone(self.db, str(phone))
        record = self._find_call(call_id)
        if record is None:
            return None
        if record.patient is not None:
            return record.patient
        return find_by_phone(self.db, record.encrypted_caller_number)

    def _resolve_appointment(
        self, parameters: dict[str, Any], call_id: Optional[str]
    ) -> Optional[Appointment]:
        appointment_id = parameters.get("appointment_id")
        if appointment_id:
            try:
                appointment = self.db.get(Appointment, appointment_id)
            except Exception:  # malformed uuid from a speech-to-text mangle
                appointment = None
            if appointment is not None:
                return appointment

        patient = self._patient_for_call(parameters, call_id)
        if patient is None:
            return None
        return (
            self.db.execute(
                select(Appointment)
                .where(
                    Appointment.patient_id == patient.id,
                    Appointment.status.in_(AppointmentStatus.ACTIVE),
                    Appointment.scheduled_for >= utcnow(),
                )
                .order_by(Appointment.scheduled_for)
            )
            .scalars()
            .first()
        )


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
    """Normalise a VAPI action/tool-call body into ``(action, params, call_id)``.

    VAPI has shipped several shapes for this (``functionCall``, ``toolCalls``,
    and a flat ``action``/``parameters`` body). Accepting all of them keeps the
    integration working across VAPI versions instead of breaking on an upgrade.
    """
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
        "botox": "botox",
        "tox": "botox",
        "wrinkle relaxer": "botox",
        "filler": "fillers",
        "fillers": "fillers",
        "lip filler": "fillers",
        "laser": "laser",
        "laser hair removal": "laser",
        "hair removal": "laser",
        "facial": "facial",
        "hydrafacial": "facial",
        "peel": "peel",
        "chemical peel": "peel",
        "consult": "consultation",
        "consultation": "consultation",
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


def _prompt_dir() -> Path:
    if settings.voice_prompt_dir:
        return Path(settings.voice_prompt_dir)
    # Repo layout: backend/app/services/… -> ../../../voice-agent/system-prompts
    return Path(__file__).resolve().parents[3] / "voice-agent" / "system-prompts"


def load_faq_prompt() -> str:
    path = _prompt_dir() / "faq-agent.txt"
    try:
        return path.read_text(encoding="utf-8").replace("[CLINIC_NAME]", settings.clinic_name)
    except OSError:
        logger.warning("FAQ prompt not found at %s — using the built-in fallback", path)
        return (
            f"You are Bella, the assistant for {settings.clinic_name}, a med spa. Answer "
            "logistical questions in two sentences or fewer. Never give medical advice, "
            "diagnoses, or discuss contraindications, medications or side effects — for "
            "anything clinical, say a provider will call back within 2 hours."
        )


def load_price_list() -> dict[str, dict[str, Any]]:
    path = os.environ.get("PRICE_LIST_PATH") or str(_prompt_dir().parent / "price-list.json")
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else DEFAULT_PRICE_LIST
    except (OSError, ValueError):
        return DEFAULT_PRICE_LIST


__all__ = ["VoiceService", "extract_action", "load_price_list", "load_faq_prompt"]
