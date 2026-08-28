"""Lead qualification: scoring, conversation, routing.

The six questions from the brief, asked in order, over web chat or SMS:

1. Which treatment?
2. Had it before?
3. Pregnant or breastfeeding?  → disqualify + medical callback
4. On blood thinners?          → flag for provider approval
5. Budget range?
6. When are you looking to book?

**Flow control is deterministic; only language is generated.** The state
machine decides which question comes next and what a lead scores. The model is
used for two narrow jobs — turning "prob like 2 grand" into ``1000-2000``, and
writing a warm one-line acknowledgement. That keeps qualification auditable
and identical whether or not OpenAI is reachable, which matters when the answer
to question 3 determines whether someone gets injected.

Every prompt is de-identified before it leaves the process
(:mod:`app.services.deidentify`).
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
from app.models.retention_event import RetentionEventType
from app.services import sms_service as templates
from app.services.booking_service import get_booking_service
from app.services.deidentify import DeidentificationContext
from app.services.encryption import get_encryption_service, normalise_identifier
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
        "options": ["Botox", "Fillers", "Laser hair removal", "Facial", "Chemical peel", "Something else"],
        "values": {
            "botox": "botox",
            "fillers": "fillers",
            "filler": "fillers",
            "laser hair removal": "laser",
            "laser": "laser",
            "facial": "facial",
            "chemical peel": "peel",
            "peel": "peel",
            "something else": "other",
            "other": "other",
        },
    },
    {
        "key": "previous_experience",
        "text": "Have you had this treatment before?",
        "options": ["Yes", "No"],
        "values": {"yes": True, "no": False},
    },
    {
        "key": "is_pregnant",
        "text": "Are you currently pregnant or breastfeeding?",
        "options": ["Yes", "No"],
        "values": {"yes": True, "no": False},
    },
    {
        "key": "blood_thinner",
        "text": "Are you taking any blood thinners (for example aspirin, warfarin or fish oil)?",
        "options": ["Yes", "No", "Not sure"],
        "values": {"yes": True, "no": False, "not sure": True},
    },
    {
        "key": "budget_range",
        "text": "What budget range are you working with?",
        "options": ["$0-500", "$500-1000", "$1000-2000", "$2000+"],
        "values": {
            "$0-500": "0-500",
            "0-500": "0-500",
            "$500-1000": "500-1000",
            "500-1000": "500-1000",
            "$1000-2000": "1000-2000",
            "1000-2000": "1000-2000",
            "$2000+": "2000+",
            "2000+": "2000+",
        },
    },
    {
        "key": "timeline",
        "text": "When are you looking to book?",
        "options": ["As soon as possible", "In 1-2 weeks", "Within a month", "Just browsing"],
        "values": {
            "as soon as possible": "asap",
            "asap": "asap",
            "in 1-2 weeks": "1-2_weeks",
            "1-2 weeks": "1-2_weeks",
            "within a month": "1_month",
            "1 month": "1_month",
            "just browsing": "browsing",
            "browsing": "browsing",
        },
    },
]

QUESTION_BY_KEY = {question["key"]: question for question in QUESTIONS}

#: Asked after the six, because booking a consultation needs somewhere to send it.
CONTACT_STEP = "contact"

SCORE_WEIGHTS: dict[str, dict[Any, int]] = {
    "treatment_interest": {"botox": 15, "fillers": 15, "laser": 15, "facial": 15, "peel": 15, "other": 8},
    "previous_experience": {True: 15, False: 8},
    "budget_range": {"0-500": 10, "500-1000": 20, "1000-2000": 28, "2000+": 35},
    "timeline": {"asap": 35, "1-2_weeks": 28, "1_month": 15, "browsing": 5},
}

#: Anything that should be answered by a licensed provider, not a chatbot.
MEDICAL_QUESTION_PATTERNS = re.compile(
    r"\b(side effect|contraindicat|allerg|medication|prescri|interact|"
    # "safe" unqualified: in a med spa inbox, "is this safe" is always a
    # provider question, and the cost of over-escalating is one extra callback.
    r"safe|unsafe|risk|bruis|swell|complication|reaction|pain|painful|hurt|"
    r"blood thinner|thinner|anticoagulant|warfarin|aspirin|fish oil|"
    r"autoimmune|lupus|diabet|blood pressure|surgery|antibiotic|"
    r"accutane|isotretinoin|botulism|migraine|pregnan|breastfeed|nursing)\b",
    re.IGNORECASE,
)

MEDICAL_CALLBACK_REPLY = (
    "That's an important question for our medical provider — I'm not able to give medical "
    "advice. I'll have them call you back within 2 hours."
)


class LeadService:
    def __init__(self, db: Session, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self.sms = SMSService(db, self.audit)

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
        """Score 0-100 with a per-answer breakdown.

        Pregnancy is an absolute gate, not a weight: no arrangement of the
        other five answers should be able to route someone who is pregnant into
        an auto-booked injectable consultation.
        """
        breakdown: dict[str, Any] = {}

        if lead.is_pregnant is True:
            breakdown["disqualified"] = "pregnant_or_breastfeeding"
            return 0, breakdown, LeadTemperature.COLD

        total = 0
        for key, weights in SCORE_WEIGHTS.items():
            value = getattr(lead, key, None)
            if value is None:
                breakdown[key] = 0
                continue
            points = weights.get(value, 0)
            breakdown[key] = points
            total += points

        if lead.blood_thinner is True:
            # No score penalty — the brief says flag, not reject. It changes
            # who has to sign off, not how interested the person is.
            breakdown["blood_thinner_flag"] = "provider_approval_required"

        total = max(0, min(100, total))
        if total >= 80:
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
        lead.needs_provider_approval = lead.blood_thinner is True
        lead.qualified_at = utcnow()

        booking_url: Optional[str] = None

        if lead.is_pregnant is True:
            lead.status = LeadStatus.DISQUALIFIED
            lead.next_action = "medical_callback"
            lead.medical_callback_required = True
        elif temperature == LeadTemperature.HOT:
            lead.status = LeadStatus.QUALIFIED
            lead.next_action = "auto_book_consultation"
            booking_url = self._auto_book_consultation(lead)
        elif temperature == LeadTemperature.WARM:
            lead.status = LeadStatus.QUALIFIED
            lead.next_action = "staff_followup_24h"
        else:
            lead.status = LeadStatus.NURTURE
            lead.next_action = "educational_nurture"

        self.audit.log_access(
            "write",
            None,
            DataCategory.LEAD_QUALIFICATION,
            "lead-agent",
            details={
                "score": score,
                "temperature": temperature,
                "status": lead.status,
                "next_action": lead.next_action,
                "provider_approval": lead.needs_provider_approval,
            },
        )
        self.db.commit()

        if notify:
            notify_lead_qualified(lead)

        return {
            "lead_id": lead.id,
            "score": score,
            "temperature": temperature,
            "status": lead.status,
            "next_action": lead.next_action,
            "needs_provider_approval": lead.needs_provider_approval,
            "medical_callback_required": lead.medical_callback_required,
            "booking_url": booking_url or lead.calendly_booking_url,
            "score_breakdown": breakdown,
            "answered_questions": lead.answered_questions,
        }

    def _auto_book_consultation(self, lead: Lead) -> Optional[str]:
        """Hot lead → get a consultation on the calendar.

        Two paths, because "auto-book" means different things depending on who
        owns the calendar:

        * **Calendly configured** — Calendly owns availability, and its API
          cannot pick a time on someone's behalf. We mint a single-use
          scheduling link and text it. The lead becomes ``booked`` when
          Calendly's ``invitee.created`` webhook arrives.
        * **Otherwise** — this system owns the calendar, so it books the next
          open consultation slot outright and texts a confirmation.
        """
        if not lead.phone:
            # Nothing to text yet; the chat asks for contact details next.
            return settings.calendly_scheduling_url if settings.calendly_enabled else None

        if settings.calendly_enabled:
            url = self._create_calendly_link() or settings.calendly_scheduling_url
            lead.calendly_booking_url = url
            self.sms.send(
                to=lead.phone,
                body=(
                    f"Thanks for your interest in {settings.clinic_name}! Grab a consultation slot "
                    f"here: {url}"
                ),
                template="consultation_confirmation",
                sms_consent=True,
            )
            return url

        booking = get_booking_service(self.db)
        slots = booking.get_available_slots(service="consultation", days_ahead=10, limit=1)
        if not slots:
            logger.warning("No consultation slots available for hot lead %s", lead.id)
            return settings.clinic_booking_url

        slot = slots[0]
        patient, _ = get_or_create_patient(
            self.db,
            phone=lead.phone,
            name=lead.name,
            email=lead.email,
            sms_consent=True,
            audit=self.audit,
            user_id="lead-agent",
        )
        reference = booking.create_booking(
            service="consultation",
            start=slot.start,
            patient_name=lead.name,
            patient_phone=lead.phone,
            patient_email=lead.email,
        )
        appointment = Appointment(
            patient_id=patient.id,
            service="consultation",
            scheduled_for=slot.start,
            duration_minutes=settings.appointment_slot_minutes,
            status=AppointmentStatus.CONFIRMED,
            source=AppointmentSource.WEB,
            external_id=reference.external_id,
            extra={"lead_id": str(lead.id), "auto_booked": True},
        )
        self.db.add(appointment)
        self.db.flush()

        lead.status = LeadStatus.BOOKED
        lead.calendly_event_id = reference.external_id

        self.sms.send(
            to=lead.phone,
            body=templates.consultation_confirmation(when_text=format_appointment_time(slot.start)),
            template="consultation_confirmation",
            patient_uuid=str(patient.id),
            sms_consent=True,
        )
        self.audit.log_write(
            str(patient.id),
            DataCategory.APPOINTMENT,
            "lead-agent",
            details={"auto_booked": True, "score": lead.qualification_score},
        )
        return settings.clinic_booking_url

    def _create_calendly_link(self) -> Optional[str]:
        """Mint a single-use Calendly scheduling link."""
        if httpx is None or not settings.calendly_enabled:
            return None
        try:
            response = httpx.post(
                "https://api.calendly.com/scheduling_links",
                headers={
                    "Authorization": f"Bearer {settings.calendly_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "max_event_count": 1,
                    "owner": settings.calendly_event_type_uri,
                    "owner_type": "EventType",
                },
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json().get("resource", {}).get("booking_url")
        except Exception as exc:
            logger.error("Calendly link creation failed: %s", type(exc).__name__)
            return None

    # ------------------------------------------------------------------ #
    # Conversation
    # ------------------------------------------------------------------ #
    def chat(self, *, message: str, session_id: Optional[str], source: str) -> dict[str, Any]:
        """One turn of the qualification conversation."""
        session_id = session_id or uuid.uuid4().hex
        lead = self.get_or_create_by_session(session_id, source=source)
        return self._advance(lead, message=message, channel="chat")

    def handle_sms(self, *, from_phone: str, body: str) -> dict[str, Any]:
        """One turn over SMS. Same state machine, same scoring."""
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

        # A clinical question always wins over the script.
        medical = bool(MEDICAL_QUESTION_PATTERNS.search(message)) and asking != "is_pregnant"
        if medical:
            lead.medical_callback_required = True

        acknowledgement: Optional[str] = None

        # Record the answer to whatever we last asked.
        if asking and asking != CONTACT_STEP and not medical:
            question = QUESTION_BY_KEY.get(asking)
            if question is not None:
                value, acknowledgement = self._interpret(question, message, safe_message, lead)
                if value is not None:
                    setattr(lead, question["key"], value)
                    if lead.status == LeadStatus.NEW:
                        lead.status = LeadStatus.QUALIFYING
                else:
                    # Could not parse — ask the same question again rather than
                    # guessing. A wrong answer to "are you pregnant?" is not a
                    # recoverable error.
                    reply = self._compose(
                        acknowledgement or "Sorry, I didn't quite catch that.", question
                    )
                    return self._respond(lead, state, asking, reply, question, channel)
        elif asking == CONTACT_STEP and not medical:
            captured = self._capture_contact(lead, message)
            if not captured:
                return self._respond(
                    lead,
                    state,
                    CONTACT_STEP,
                    "Could I get the best phone number to reach you on? Just the digits is fine.",
                    None,
                    channel,
                )

        # Pregnancy disqualifies immediately — no further questions.
        if lead.is_pregnant is True:
            lead.medical_callback_required = True
            result = self.qualify(lead)
            reply = (
                "Thank you for letting me know — that's really important. We don't perform most "
                "treatments during pregnancy or breastfeeding, so I'll have our medical provider "
                "call you within 2 hours to talk through what's safe and when to come back."
            )
            state["asking"] = None
            return self._finish(lead, state, reply, result, channel)

        if medical:
            state["asking"] = asking  # re-ask the same question after the handoff line
            reply = MEDICAL_CALLBACK_REPLY
            question = QUESTION_BY_KEY.get(asking) if asking else None
            if question:
                reply = f"{reply} In the meantime — {question['text']}"
            self.db.commit()
            return self._respond(lead, state, asking, reply, question, channel)

        # Next unanswered question.
        next_question = self._next_question(lead)
        if next_question is not None:
            reply = self._compose(acknowledgement, next_question)
            return self._respond(lead, state, next_question["key"], reply, next_question, channel)

        # All six answered. Do we have a way to reach them?
        if not lead.phone:
            reply = self._compose(
                acknowledgement,
                None,
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

    def _interpret(
        self, question: dict[str, Any], raw: str, safe: str, lead: Lead
    ) -> tuple[Any, Optional[str]]:
        """Map a free-text answer onto an allowed value.

        Exact-match and keyword rules run first — they are free, instant and
        deterministic. The model is only consulted for genuinely fuzzy input
        ("somewhere around two grand"), and its output is still constrained to
        the allowed values.
        """
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
                "You classify a med spa lead's answer to one intake question. "
                f"Allowed values: {allowed}. Reply with JSON: "
                '{"value": <one allowed value, or null if the answer does not '
                'contain one>, "acknowledgement": "<max 12 words, warm, no questions>"}. '
                "Never invent a value. Placeholders like [PATIENT_1] are opaque tokens."
            ),
            user=f"Question: {question['text']}\nAnswer: {safe}",
            purpose="lead_answer_classification",
            temperature=0.0,
            max_tokens=120,
            audit=self.audit,
        )
        if not payload:
            return None, None

        value = payload.get("value")
        acknowledgement = payload.get("acknowledgement")
        if isinstance(acknowledgement, str):
            acknowledgement = acknowledgement.strip()[:160] or None

        if value is None or str(value).lower() in {"null", "none", ""}:
            return None, acknowledgement

        coerced = self._coerce(question, str(value))
        return coerced, acknowledgement

    @staticmethod
    def _keyword_match(question: dict[str, Any], normalised: str) -> Any:
        key = question["key"]

        if key in {"previous_experience", "is_pregnant", "blood_thinner"}:
            if re.search(r"\b(yes|yeah|yep|yup|correct|i am|i have|sure)\b", normalised):
                return True
            if re.search(r"\b(no|nope|nah|never|not really|negative|i'm not|im not)\b", normalised):
                return False
            if key == "blood_thinner" and re.search(r"\b(not sure|unsure|dunno|maybe)\b", normalised):
                # Treated as yes: an unverified "maybe" on anticoagulants is a
                # provider decision, not a chatbot's.
                return True
            return None

        if key == "treatment_interest":
            for phrase, value in question["values"].items():
                if phrase in normalised:
                    return value
            return None

        if key == "budget_range":
            for phrase, value in question["values"].items():
                if phrase in normalised:
                    return value
            amounts = [int(match) for match in re.findall(r"\d{3,5}", normalised.replace(",", ""))]
            if amounts:
                amount = max(amounts)
                if amount < 500:
                    return "0-500"
                if amount < 1000:
                    return "500-1000"
                if amount < 2000:
                    return "1000-2000"
                return "2000+"
            if re.search(r"\b(\d+)\s*(k|grand)\b", normalised):
                thousands = int(re.search(r"\b(\d+)\s*(k|grand)\b", normalised).group(1))
                return "2000+" if thousands >= 2 else "1000-2000"
            return None

        if key == "timeline":
            # Least-urgent first. "just browsing for now" contains "now", so an
            # asap-first ordering books a tyre-kicker into a consultation.
            if re.search(
                r"\b(browsing|looking around|research|curious|not sure yet|someday|no rush)\b",
                normalised,
            ):
                return "browsing"
            if re.search(r"\b(month|few weeks|4 weeks)\b", normalised):
                return "1_month"
            if re.search(r"\b(1-2 weeks|two weeks|couple of weeks|next week|fortnight)\b", normalised):
                return "1-2_weeks"
            if re.search(
                r"\b(asap|today|tomorrow|this week|urgent|as soon as possible|right away)\b",
                normalised,
            ) or re.search(r"(?<!for )\bnow\b", normalised):
                return "asap"
            return None

        return None

    @staticmethod
    def _coerce(question: dict[str, Any], value: str) -> Any:
        value = value.strip().lower()
        if question["key"] in {"previous_experience", "is_pregnant", "blood_thinner"}:
            if value in {"true", "yes"}:
                return True
            if value in {"false", "no"}:
                return False
            return None
        allowed = {str(item) for item in question["values"].values()}
        return value if value in allowed else question["values"].get(value)

    def _capture_contact(self, lead: Lead, message: str) -> bool:
        """Pull a phone number (and any offered name) out of a free-text reply."""
        digits = re.sub(r"[^\d]", "", message)
        if len(digits) < 10:
            return False
        lead.set_phone(normalise_identifier(message))

        name_match = re.search(
            r"(?:i'm|im|this is|my name is|it's)\s+([A-Za-z][\w'\-]{1,20}(?:\s+[A-Za-z][\w'\-]{1,20})?)",
            message,
            re.IGNORECASE,
        )
        if name_match and not lead.name:
            lead.set_name(name_match.group(1).strip().title())
        self.db.flush()
        return True

    def _compose(
        self,
        acknowledgement: Optional[str],
        question: Optional[dict[str, Any]],
        *,
        fallback: Optional[str] = None,
    ) -> str:
        parts = []
        if acknowledgement:
            parts.append(acknowledgement.rstrip("."))
        if question is not None:
            parts.append(question["text"])
        elif fallback:
            parts.append(fallback)
        return " ".join(part for part in parts if part).strip()

    def _closing_message(self, lead: Lead, result: dict[str, Any]) -> str:
        temperature = result["temperature"]
        if result["status"] == LeadStatus.BOOKED:
            base = (
                "Perfect — I've got you booked in for a consultation and sent a confirmation text."
            )
        elif temperature == LeadTemperature.HOT:
            base = (
                "You're a great fit. I've sent you a link to grab a consultation slot — "
                "check your texts."
            )
        elif temperature == LeadTemperature.WARM:
            base = (
                f"Thanks! Someone from {settings.clinic_name} will reach out within 24 hours to "
                "answer your questions and find a time that works."
            )
        else:
            base = (
                "Thanks for sharing all that! I'll send over some info to help you decide, and "
                "we're here whenever you're ready."
            )
        if lead.needs_provider_approval:
            base += (
                " One note: because you mentioned blood thinners, our provider will confirm "
                "everything with you before any treatment."
            )
        return base

    def _respond(
        self,
        lead: Lead,
        state: dict[str, Any],
        asking: Optional[str],
        reply: str,
        question: Optional[dict[str, Any]],
        channel: str,
    ) -> dict[str, Any]:
        state["asking"] = asking
        state["turns"] = int(state.get("turns", 0)) + 1
        state["last_reply_at"] = utcnow().isoformat()
        lead.conversation_state = state
        self.db.commit()

        if channel == "sms" and lead.phone:
            self.sms.send(
                to=lead.phone,
                body=reply,
                template="qualification_reply",
                sms_consent=True,
            )

        return {
            "session_id": lead.session_id,
            "lead_id": lead.id,
            "reply": reply,
            "options": question["options"] if question else [],
            "asking": asking,
            "complete": False,
            "status": lead.status,
            "score": lead.qualification_score,
            "next_action": lead.next_action,
            "booking_url": lead.calendly_booking_url,
        }

    def _finish(
        self, lead: Lead, state: dict[str, Any], reply: str, result: dict[str, Any], channel: str
    ) -> dict[str, Any]:
        state["asking"] = None
        state["turns"] = int(state.get("turns", 0)) + 1
        state["completed_at"] = utcnow().isoformat()
        lead.conversation_state = state
        self.db.commit()

        if channel == "sms" and lead.phone:
            self.sms.send(
                to=lead.phone, body=reply, template="qualification_reply", sms_consent=True
            )

        return {
            "session_id": lead.session_id,
            "lead_id": lead.id,
            "reply": reply,
            "options": [],
            "asking": None,
            "complete": True,
            "status": result["status"],
            "score": result["score"],
            "next_action": result["next_action"],
            "booking_url": result.get("booking_url"),
        }

    def greeting(self) -> dict[str, Any]:
        """Opening turn for a fresh widget session."""
        question = QUESTIONS[0]
        return {
            "reply": (
                f"Hi! I'm the {settings.clinic_name} assistant. A few quick questions and I'll "
                f"get you to the right place. {question['text']}"
            ),
            "options": question["options"],
            "asking": question["key"],
        }

    # ------------------------------------------------------------------ #
    # Nurture
    # ------------------------------------------------------------------ #
    def send_nurture(self, lead_id: UUID, *, step: int = 0) -> dict[str, Any]:
        lead = self.db.get(Lead, lead_id)
        if lead is None:
            return {"status": "not_found"}
        if not lead.phone:
            return {"status": "skipped", "reason": "no_phone"}

        state = dict(lead.conversation_state or {})
        last_sent = state.get("last_nurture_at")
        if last_sent:
            from app.utils import parse_datetime

            parsed = parse_datetime(last_sent)
            if parsed and parsed > utcnow() - timedelta(days=2):
                return {"status": "skipped", "reason": "cooldown"}

        result = self.sms.send(
            to=lead.phone,
            body=templates.nurture_message(step=step, treatment=lead.treatment_interest),
            template="nurture",
            sms_consent=True,
        )
        state["last_nurture_at"] = utcnow().isoformat()
        state["nurture_step"] = step
        lead.conversation_state = state

        from app.services.retention_service import RetentionService

        RetentionService(self.db, self.audit).record_event(
            event_type=RetentionEventType.NURTURE_SENT,
            lead_id=lead.id,
            metadata={"step": step, "sms_status": result.status},
        )
        self.db.commit()
        return {"status": "sent" if result.ok else "suppressed", "step": step}

    # ------------------------------------------------------------------ #
    # Views
    # ------------------------------------------------------------------ #
    def lead_view(self, lead_id: UUID) -> Optional[dict[str, Any]]:
        """De-identified lead payload. This is what the frontend may see."""
        lead = self.db.get(Lead, lead_id)
        if lead is None:
            return None
        self.audit.log_read(None, DataCategory.LEAD_QUALIFICATION, "frontend")
        return {
            "lead_id": lead.id,
            "source": lead.source,
            "status": lead.status,
            "temperature": lead.temperature,
            "score": lead.qualification_score,
            "treatment_interest": lead.treatment_interest,
            "budget_range": lead.budget_range,
            "timeline": lead.timeline,
            "needs_provider_approval": lead.needs_provider_approval,
            "medical_callback_required": lead.medical_callback_required,
            "display_name": mask_name(lead.name) or "Anonymous",
            "masked_phone": mask_phone(lead.phone),
            "created_at": lead.created_at,
            "answered_questions": lead.answered_questions,
        }


__all__ = ["LeadService", "QUESTIONS", "SCORE_WEIGHTS", "MEDICAL_CALLBACK_REPLY"]
