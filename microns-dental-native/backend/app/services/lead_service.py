"""Module 5 — lead qualification (website chat + inbound SMS).

The six questions from the brief, asked in order:

1. What treatment are you most interested in?
2. When was your last dental visit?
3. Do you have dental insurance?
4. Are you experiencing any pain or emergency right now?
5. When are you looking to be seen?
6. Preferred contact number (+ name, if offered)

**Flow control is deterministic; only language is generated.** The state
machine decides which question comes next and what a lead scores. The model
turns free text like "pretty bad, been hurting since yesterday" into one of
the allowed answer values, and writes a warm one-line acknowledgement — it
never decides the score or the routing itself.

Severe pain is not scored and moved on from like everything else: it flags
``needs_emergency_escalation`` immediately and fires the same on-call alert +
patient reassurance the after-hours emergency-capture module sends, because a
dental emergency answered on a lead-qualification chat is still a dental
emergency.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import timedelta
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.lead import Lead, LeadSource, LeadStatus, LeadTemperature
from app.services import sms_service as templates
from app.services.deidentify import DeidentificationContext
from app.services.encryption import get_encryption_service, normalise_identifier
from app.services.gmail_service import get_gmail_service
from app.services.google_calendar_service import CalendarEventParser, GoogleCalendarService
from app.services.google_contacts_service import get_contacts_service
from app.services.google_drive_service import get_drive_service
from app.services.hipaa_audit import DataCategory, HIPAAAuditLogger
from app.services.llm import get_llm
from app.services.notifier import notify_lead_qualified
from app.services.patient_service import get_or_create_patient
from app.services.sms_service import SMSService
from app.utils import format_appointment_time, mask_name, mask_phone, utcnow

logger = logging.getLogger(__name__)

try:  # pragma: no cover
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore[assignment]


# --------------------------------------------------------------------- #
# Question definitions
# --------------------------------------------------------------------- #
QUESTIONS: list[dict[str, Any]] = [
    {
        "key": "treatment_interest",
        "text": "What treatment are you most interested in?",
        "options": ["Cleaning", "Emergency", "Invisalign", "Implants", "Whitening", "Veneers", "Other"],
        "values": {
            "cleaning": "cleaning",
            "emergency": "emergency",
            "invisalign": "invisalign",
            "implants": "implants",
            "implant": "implants",
            "whitening": "whitening",
            "veneers": "veneers",
            "veneer": "veneers",
            "other": "other",
        },
    },
    {
        "key": "last_visit",
        "text": "When was your last dental visit?",
        "options": ["Within 6 months", "1-2 years", "2+ years", "Never"],
        "values": {
            "within 6 months": "within_6_months",
            "1-2 years": "1_2_years",
            "2+ years": "2_plus_years",
            "never": "never",
        },
    },
    {
        "key": "insurance_type",
        "text": "Do you have dental insurance?",
        "options": ["Yes - PPO", "Yes - HMO", "Yes - Medicaid", "No", "Not sure"],
        "values": {
            "yes - ppo": "ppo",
            "ppo": "ppo",
            "yes - hmo": "hmo",
            "hmo": "hmo",
            "yes - medicaid": "medicaid",
            "medicaid": "medicaid",
            "no": "none",
            "not sure": "not_sure",
        },
    },
    {
        "key": "pain_level",
        "text": "Are you experiencing any pain or emergency right now?",
        "options": ["Yes - severe", "Yes - moderate", "No"],
        "values": {"yes - severe": "severe", "severe": "severe", "yes - moderate": "moderate", "moderate": "moderate", "no": "none"},
    },
    {
        "key": "timeline",
        "text": "When are you looking to be seen?",
        "options": ["Today", "This week", "Within 2 weeks", "Just browsing"],
        "values": {
            "today": "today",
            "this week": "this_week",
            "within 2 weeks": "within_2_weeks",
            "just browsing": "browsing",
            "browsing": "browsing",
        },
    },
]

QUESTION_BY_KEY = {question["key"]: question for question in QUESTIONS}

#: Asked after the five, because booking a consultation needs somewhere to send it.
CONTACT_STEP = "contact"

SCORE_WEIGHTS: dict[str, dict[Any, int]] = {
    "treatment_interest": {
        "cleaning": 10, "emergency": 20, "invisalign": 15, "implants": 15,
        "whitening": 8, "veneers": 12, "other": 8,
    },
    "last_visit": {"within_6_months": 5, "1_2_years": 10, "2_plus_years": 15, "never": 15},
    "insurance_type": {"ppo": 15, "hmo": 12, "medicaid": 10, "none": 5, "not_sure": 8},
    "pain_level": {"severe": 35, "moderate": 15, "none": 0},
    "timeline": {"today": 35, "this_week": 28, "within_2_weeks": 15, "browsing": 5},
}


class LeadService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)
        self.calendar = GoogleCalendarService()

    # ------------------------------------------------------------------ #
    # Lead lookup / creation
    # ------------------------------------------------------------------ #
    def get_or_create_by_session(self, session_id: str, source: str = LeadSource.WEBSITE_CHAT) -> Lead:
        lead = self.db.execute(select(Lead).where(Lead.session_id == session_id)).scalar_one_or_none()
        if lead is not None:
            return lead
        lead = Lead(session_id=session_id, source=source, conversation_state={}, score_breakdown={})
        self.db.add(lead)
        self.db.flush()
        self.audit.log_write(None, DataCategory.LEAD_QUALIFICATION, "widget", details={"created": True})
        return lead

    def get_or_create_by_phone(self, phone: str, source: str = LeadSource.SMS) -> Lead:
        fingerprint = get_encryption_service().fingerprint(phone)
        lead = (
            self.db.execute(
                select(Lead)
                .where(
                    Lead.phone_fingerprint == fingerprint,
                    Lead.status.in_((LeadStatus.NEW, LeadStatus.QUALIFYING)),
                )
                .order_by(Lead.created_at.desc())
            )
            .scalars()
            .first()
        )
        if lead is not None:
            return lead
        lead = Lead(
            session_id=f"sms:{fingerprint[:24]}:{uuid.uuid4().hex[:8]}",
            source=source,
            conversation_state={},
            score_breakdown={},
        )
        lead.set_phone(normalise_identifier(phone))
        self.db.add(lead)
        self.db.flush()
        return lead

    # ------------------------------------------------------------------ #
    # Scoring
    # ------------------------------------------------------------------ #
    def score_lead(self, lead: Lead) -> tuple[int, dict[str, Any], str]:
        """Score 0-100 with a per-answer breakdown."""
        breakdown: dict[str, Any] = {}
        total = 0
        for key, weights in SCORE_WEIGHTS.items():
            value = getattr(lead, key, None)
            if value is None:
                breakdown[key] = 0
                continue
            points = weights.get(value, 0)
            breakdown[key] = points
            total += points

        total = max(0, min(100, total))
        if lead.pain_level == "severe" or total >= 80:
            temperature = LeadTemperature.HOT
        elif total >= 50:
            temperature = LeadTemperature.WARM
        else:
            temperature = LeadTemperature.COLD
        return total, breakdown, temperature

    # ------------------------------------------------------------------ #
    # Qualification + routing
    # ------------------------------------------------------------------ #
    def qualify(self, lead: Lead, *, notify: bool = True) -> dict[str, Any]:
        """Score the lead, set its status, and take the routing action."""
        score, breakdown, temperature = self.score_lead(lead)
        lead.qualification_score = score
        lead.score_breakdown = breakdown
        lead.temperature = temperature
        lead.needs_emergency_escalation = lead.pain_level == "severe"
        lead.qualified_at = utcnow()

        booking_url: Optional[str] = None

        if lead.needs_emergency_escalation:
            lead.status = LeadStatus.QUALIFIED
            lead.next_action = "emergency_escalation"
            self._escalate_emergency(lead)
        elif temperature == LeadTemperature.HOT:
            lead.status = LeadStatus.QUALIFIED
            lead.next_action = "auto_hold_consultation"
            booking_url = self._auto_hold_consultation(lead)
        elif temperature == LeadTemperature.WARM:
            lead.status = LeadStatus.QUALIFIED
            lead.next_action = "staff_followup_call"
            self._create_followup_call_task(lead)
        else:
            lead.status = LeadStatus.NURTURE
            lead.next_action = "educational_nurture"
            self._start_nurture(lead)

        self.audit.log_access(
            "write", None, DataCategory.LEAD_QUALIFICATION, "lead-agent",
            details={
                "score": score, "temperature": temperature, "status": lead.status,
                "next_action": lead.next_action, "emergency_escalation": lead.needs_emergency_escalation,
            },
        )
        self.db.commit()

        if notify:
            notify_lead_qualified(lead)

        return {
            "lead_id": lead.id,
            "score": score,
            "tier": temperature,
            "status": lead.status,
            "next_action": lead.next_action,
            "booking_url": booking_url or lead.calendly_booking_url,
            "score_breakdown": breakdown,
            "answered_questions": lead.answered_questions,
        }

    def _escalate_emergency(self, lead: Lead) -> None:
        """Severe-pain answer -> the same on-call alert Module 4 fires."""
        if lead.phone:
            self.sms.send(
                to=lead.phone,
                body=templates.emergency_reassurance_urgent(),
                template="emergency_reassurance_urgent",
                sms_consent=True,
            )
        try:
            get_gmail_service().send_message(
                to=settings.on_call_dentist_email or settings.front_desk_email or "",
                subject=f"\U0001F6A8 EMERGENCY CALLBACK: {mask_name(lead.name) or 'New lead'} | {mask_phone(lead.phone)}",
                body=(
                    f"URGENT dental emergency reported via lead qualification. Patient: "
                    f"{mask_name(lead.name) or 'unknown'}. Phone: {mask_phone(lead.phone)}. "
                    f"Treatment interest: {lead.treatment_interest or 'not given'}. Please call back "
                    "within 15 minutes."
                ),
            )
        except Exception as exc:  # pragma: no cover - Google not configured yet
            logger.warning("Emergency escalation email skipped: %s", type(exc).__name__)

    def _auto_hold_consultation(self, lead: Lead) -> Optional[str]:
        """Hot lead -> hold a new-patient exam slot on the calendar."""
        if not lead.phone:
            return settings.calendly_scheduling_url if settings.calendly_enabled else None

        slots = self._get_calendly_slots(settings.calendly_new_patient_event_type_uri, days_ahead=7, limit=3)
        if not slots:
            return settings.practice_booking_url

        slot_texts = [format_appointment_time(slot["start"]) for slot in slots]
        booking_url = slots[0].get("scheduling_url") or settings.calendly_scheduling_url

        patient, _ = get_or_create_patient(
            self.db, phone=lead.phone, name=lead.name, sms_consent=True, audit=self.audit, user_id="lead-agent",
        )

        event = None
        if settings.google_primary_calendar_id:
            description = CalendarEventParser.build_appointment_description(
                patient_id=str(patient.id), patient_name=patient.name or "New Patient",
                phone=patient.phone, service=lead.treatment_interest or "New Patient Exam",
            )
            event = self.calendar.create_event(
                settings.google_primary_calendar_id,
                summary=f"HOLD: New Patient Consultation - {mask_name(patient.name)}",
                description=description,
                start=slots[0]["start"], end=slots[0]["start"] + timedelta(minutes=settings.appointment_slot_minutes),
            )
            lead.google_event_id = event.get("id") if event else None

        self.sms.send(
            to=lead.phone,
            body=templates.consultation_hold_offer(
                slot1=slot_texts[0], slot2=slot_texts[1] if len(slot_texts) > 1 else None,
                slot3=slot_texts[2] if len(slot_texts) > 2 else None, booking_url=booking_url,
            ),
            template="consultation_hold_offer", patient_uuid=str(patient.id), sms_consent=True,
        )
        try:
            get_gmail_service().create_draft(
                to=settings.front_desk_email or "",
                subject=f"New hot lead: {mask_name(patient.name)} - prep welcome packet",
                body=(
                    f"{mask_name(patient.name)} ({mask_phone(patient.phone)}) qualified HOT for "
                    f"{lead.treatment_interest} and was offered consultation slots. New patient forms "
                    "link to send: [Forms Link]. Please follow up if they do not book within 24h."
                ),
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("Hot-lead welcome draft skipped: %s", type(exc).__name__)
        try:
            get_contacts_service().add_prospect(
                given_name=(patient.name or "New Patient").split(" ")[0],
                family_name=" ".join((patient.name or "").split(" ")[1:]) or None,
                phone=patient.phone, email=patient.email,
            )
            get_drive_service().create_folder(f"{mask_name(patient.name)} - New Lead {utcnow().date().isoformat()}")
        except Exception as exc:  # pragma: no cover - Google not configured yet
            logger.warning("Contacts/Drive step for hot lead skipped: %s", type(exc).__name__)

        return booking_url

    def _create_followup_call_task(self, lead: Lead) -> None:
        if settings.google_front_desk_calendar_id:
            self.calendar.create_event(
                settings.google_front_desk_calendar_id,
                summary=f"FOLLOW-UP CALL: {mask_name(lead.name) or 'New lead'}",
                description=f"PHONE: {mask_phone(lead.phone)}\nSERVICE: {lead.treatment_interest}\nSCORE: {lead.qualification_score}",
                start=utcnow(), end=utcnow() + timedelta(hours=1),
            )
        try:
            get_gmail_service().create_draft(
                to=settings.front_desk_email or "",
                subject=f"Call {mask_name(lead.name) or 'new lead'} about {lead.treatment_interest} - qualified warm lead",
                body=f"Please call about {lead.treatment_interest} - qualified warm lead. Phone: {mask_phone(lead.phone)}",
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("Warm-lead call-task draft skipped: %s", type(exc).__name__)
        if lead.phone:
            self.sms.send(
                to=lead.phone, body=templates.warm_lead_ack(), template="warm_lead_ack", sms_consent=True,
            )

    def _start_nurture(self, lead: Lead) -> None:
        if lead.phone:
            self.sms.send(
                to=lead.phone, body=templates.lead_nurture_day1(treatment=lead.treatment_interest),
                template="lead_nurture_day1", sms_consent=True,
            )
        state = dict(lead.conversation_state or {})
        state["nurture_step"] = 1
        state["nurture_next_at"] = (utcnow() + timedelta(days=2)).isoformat()
        lead.conversation_state = state

    def _get_calendly_slots(self, event_type_uri: Optional[str], *, days_ahead: int, limit: int) -> list[dict[str, Any]]:
        if httpx is None or not settings.calendly_enabled or not event_type_uri:
            return []
        try:
            response = httpx.get(
                f"{event_type_uri}/available_times",
                headers={"Authorization": f"Bearer {settings.calendly_api_key}"},
                params={
                    "start_time": utcnow().isoformat() + "Z",
                    "end_time": (utcnow() + timedelta(days=days_ahead)).isoformat() + "Z",
                },
                timeout=10.0,
            )
            response.raise_for_status()
            from app.utils import parse_datetime

            collection = response.json().get("collection", [])[:limit]
            return [
                {"start": parse_datetime(item.get("start_time")), "scheduling_url": item.get("scheduling_url")}
                for item in collection
                if parse_datetime(item.get("start_time")) is not None
            ]
        except Exception as exc:
            logger.error("Calendly availability fetch failed: %s", type(exc).__name__)
            return []

    # ------------------------------------------------------------------ #
    # Conversation
    # ------------------------------------------------------------------ #
    def chat(self, *, message: str, session_id: Optional[str], source: str) -> dict[str, Any]:
        session_id = session_id or uuid.uuid4().hex
        lead = self.get_or_create_by_session(session_id, source=source)
        return self._advance(lead, message=message, channel="chat")

    def handle_sms(self, *, from_phone: str, body: str) -> dict[str, Any]:
        lead = self.get_or_create_by_phone(from_phone, source=LeadSource.SMS)
        self.audit.log_sms_received(None, message_sid=None)
        return self._advance(lead, message=body, channel="sms")

    def _advance(self, lead: Lead, *, message: str, channel: str) -> dict[str, Any]:
        state = dict(lead.conversation_state or {})
        asking = state.get("asking")
        message = (message or "").strip()

        context = DeidentificationContext(patient_uuid=str(lead.id))
        context.register_name(lead.name)
        safe_message = context.deidentify(message)

        acknowledgement: Optional[str] = None

        if asking and asking != CONTACT_STEP:
            question = QUESTION_BY_KEY.get(asking)
            if question is not None:
                value, acknowledgement = self._interpret(question, message, safe_message)
                if value is not None:
                    setattr(lead, question["key"], value)
                    if lead.status == LeadStatus.NEW:
                        lead.status = LeadStatus.QUALIFYING
                else:
                    reply = self._compose(acknowledgement or "Sorry, I didn't quite catch that.", question)
                    return self._respond(lead, state, asking, reply, question, channel)
        elif asking == CONTACT_STEP:
            captured = self._capture_contact(lead, message)
            if not captured:
                return self._respond(
                    lead, state, CONTACT_STEP,
                    "Could I get the best phone number to reach you on? Just the digits is fine.",
                    None, channel,
                )

        # Severe pain always wins — score immediately and escalate.
        if lead.pain_level == "severe" and lead.status != LeadStatus.QUALIFIED:
            result = self.qualify(lead)
            reply = (
                "That sounds like it needs attention right away. I've alerted our on-call dentist "
                "and they'll call you back within 15 minutes. If this is life-threatening, please "
                "call 911."
            )
            state["asking"] = None
            return self._finish(lead, state, reply, result, channel)

        next_question = self._next_question(lead)
        if next_question is not None:
            reply = self._compose(acknowledgement, next_question)
            return self._respond(lead, state, next_question["key"], reply, next_question, channel)

        if not lead.phone:
            reply = self._compose(
                acknowledgement, None,
                fallback="Last thing — what's the best phone number for our team to reach you on?",
            )
            return self._respond(lead, state, CONTACT_STEP, reply, None, channel)

        result = self.qualify(lead)
        reply = self._closing_message(lead, result)
        state["asking"] = None
        return self._finish(lead, state, reply, result, channel)

    def _next_question(self, lead: Lead) -> Optional[dict[str, Any]]:
        for question in QUESTIONS:
            if getattr(lead, question["key"], None) is None:
                return question
        return None

    def _interpret(self, question: dict[str, Any], raw: str, safe: str) -> tuple[Any, Optional[str]]:
        normalised = raw.strip().lower().strip(".!?")

        direct = question["values"].get(normalised)
        if direct is not None:
            return direct, None

        keyword = self._keyword_match(question, normalised)
        if keyword is not None:
            return keyword, None

        allowed = sorted({str(value) for value in question["values"].values()})
        payload = get_llm().complete_json(
            system=(
                "You classify a dental patient's answer to one intake question. "
                f"Allowed values: {allowed}. Reply with JSON: "
                '{"value": <one allowed value, or null if the answer does not '
                'contain one>, "acknowledgement": "<max 12 words, warm, no questions>"}. '
                "Never invent a value. Placeholders like [PATIENT_1] are opaque tokens."
            ),
            user=f"Question: {question['text']}\nAnswer: {safe}",
            purpose="lead_answer_classification", temperature=0.0, max_tokens=120, audit=self.audit,
        )
        if not payload:
            return None, None

        value = payload.get("value")
        acknowledgement = payload.get("acknowledgement")
        if isinstance(acknowledgement, str):
            acknowledgement = acknowledgement.strip()[:160] or None
        if value is None or str(value).lower() in {"null", "none", ""}:
            return None, acknowledgement

        allowed_set = {str(item) for item in question["values"].values()}
        coerced = str(value).strip().lower()
        return (coerced if coerced in allowed_set else None), acknowledgement

    @staticmethod
    def _keyword_match(question: dict[str, Any], normalised: str) -> Any:
        key = question["key"]

        if key == "pain_level":
            if re.search(r"\b(severe|excruciating|unbearable|really bad|worst|can'?t sleep)\b", normalised):
                return "severe"
            if re.search(r"\b(moderate|some pain|a little|mild|manageable)\b", normalised):
                return "moderate"
            if re.search(r"\b(no|none|not really|fine|no pain)\b", normalised):
                return "none"
            return None

        if key in {"treatment_interest", "last_visit", "insurance_type", "timeline"}:
            for phrase, value in question["values"].items():
                if phrase in normalised:
                    return value
            return None

        return None

    def _capture_contact(self, lead: Lead, message: str) -> bool:
        digits = re.sub(r"[^\d]", "", message)
        if len(digits) < 10:
            return False
        lead.set_phone(normalise_identifier(message))

        name_match = re.search(
            r"(?:i'm|im|this is|my name is|it's)\s+([A-Za-z][\w'\-]{1,20}(?:\s+[A-Za-z][\w'\-]{1,20})?)",
            message, re.IGNORECASE,
        )
        if name_match and not lead.name:
            lead.set_name(name_match.group(1).strip().title())
        self.db.flush()
        return True

    def _compose(self, acknowledgement: Optional[str], question: Optional[dict[str, Any]], *, fallback: Optional[str] = None) -> str:
        parts = []
        if acknowledgement:
            parts.append(acknowledgement.rstrip("."))
        if question is not None:
            parts.append(question["text"])
        elif fallback:
            parts.append(fallback)
        return " ".join(part for part in parts if part).strip()

    def _closing_message(self, lead: Lead, result: dict[str, Any]) -> str:
        temperature = result["tier"]
        if temperature == LeadTemperature.HOT:
            base = "Great, you're a priority — I've sent you consultation slots, check your texts."
        elif temperature == LeadTemperature.WARM:
            base = f"Thanks! Someone from {settings.practice_name} will call within 24 hours to get you scheduled."
        else:
            base = "Thanks for sharing all that! I'll send over some info to help you decide, and we're here whenever you're ready."
        return base

    def _respond(self, lead: Lead, state: dict[str, Any], asking: Optional[str], reply: str, question: Optional[dict[str, Any]], channel: str) -> dict[str, Any]:
        state["asking"] = asking
        state["turns"] = int(state.get("turns", 0)) + 1
        lead.conversation_state = state
        self.db.commit()

        if channel == "sms" and lead.phone:
            self.sms.send(to=lead.phone, body=templates.qualification_reply(reply_text=reply), template="qualification_reply", sms_consent=True)

        return {
            "session_id": lead.session_id, "lead_id": lead.id, "reply": reply,
            "options": question["options"] if question else [], "asking": asking, "complete": False,
            "status": lead.status, "score": lead.qualification_score, "next_action": lead.next_action,
            "booking_url": lead.calendly_booking_url,
        }

    def _finish(self, lead: Lead, state: dict[str, Any], reply: str, result: dict[str, Any], channel: str) -> dict[str, Any]:
        state["asking"] = None
        state["turns"] = int(state.get("turns", 0)) + 1
        state["completed_at"] = utcnow().isoformat()
        lead.conversation_state = state
        self.db.commit()

        if channel == "sms" and lead.phone:
            self.sms.send(to=lead.phone, body=templates.qualification_reply(reply_text=reply), template="qualification_reply", sms_consent=True)

        return {
            "session_id": lead.session_id, "lead_id": lead.id, "reply": reply, "options": [],
            "asking": None, "complete": True, "status": result["status"], "score": result["score"],
            "tier": result["tier"], "next_action": result["next_action"], "booking_url": result.get("booking_url"),
        }

    def greeting(self) -> dict[str, Any]:
        question = QUESTIONS[0]
        return {
            "reply": (
                f"Hi! I'm the {settings.practice_name} assistant. A few quick questions and I'll "
                f"get you to the right place. {question['text']}"
            ),
            "options": question["options"], "asking": question["key"],
        }

    # ------------------------------------------------------------------ #
    # Nurture drip (cold leads)
    # ------------------------------------------------------------------ #
    def due_nurture_leads(self, limit: int = 200) -> list[Lead]:
        from sqlalchemy import cast, String

        rows = self.db.execute(
            select(Lead).where(Lead.status == LeadStatus.NURTURE).limit(limit)
        ).scalars().all()
        due = []
        for lead in rows:
            next_at = (lead.conversation_state or {}).get("nurture_next_at")
            if not next_at:
                continue
            from app.utils import parse_datetime

            parsed = parse_datetime(next_at)
            if parsed and parsed <= utcnow():
                due.append(lead)
        return due

    def send_nurture(self, lead_id: UUID) -> dict[str, Any]:
        lead = self.db.get(Lead, lead_id)
        if lead is None:
            return {"status": "not_found"}
        if not lead.phone:
            return {"status": "skipped", "reason": "no_phone"}

        state = dict(lead.conversation_state or {})
        step = int(state.get("nurture_step", 1))
        builders = {1: templates.lead_nurture_day1, 2: templates.lead_nurture_day3, 3: templates.lead_nurture_day7}
        offsets = {1: 2, 2: 4}  # day1 -> day3 (+2), day3 -> day7 (+4)

        builder = builders.get(step)
        if builder is None:
            return {"status": "completed"}

        body = builder(treatment=lead.treatment_interest) if step == 1 else builder()
        result = self.sms.send(to=lead.phone, body=body, template=f"lead_nurture_step{step}", sms_consent=True)

        next_step = step + 1
        state["nurture_step"] = next_step
        if next_step in offsets:
            state["nurture_next_at"] = (utcnow() + timedelta(days=offsets[next_step - 1])).isoformat()
        else:
            state.pop("nurture_next_at", None)
        lead.conversation_state = state

        from app.models.retention_event import RetentionEvent

        self.db.add(
            RetentionEvent(
                event_type="lead_nurture_sent", lead_id=lead.id,
                event_metadata={"step": step, "sms_status": result.status},
            )
        )
        self.db.commit()
        return {"status": "sent" if result.ok else "suppressed", "step": step}

    # ------------------------------------------------------------------ #
    def lead_view(self, lead_id: UUID) -> Optional[dict[str, Any]]:
        lead = self.db.get(Lead, lead_id)
        if lead is None:
            return None
        self.audit.log_read(None, DataCategory.LEAD_QUALIFICATION, "frontend")
        return {
            "lead_id": lead.id, "source": lead.source, "status": lead.status, "tier": lead.temperature,
            "score": lead.qualification_score, "treatment_interest": lead.treatment_interest,
            "timeline": lead.timeline, "display_name": mask_name(lead.name) or "Anonymous",
            "masked_phone": mask_phone(lead.phone), "created_at": lead.created_at,
            "answered_questions": lead.answered_questions,
        }


__all__ = ["LeadService", "QUESTIONS", "SCORE_WEIGHTS"]
