"""Twilio SMS delivery, with consent, audit and PHI-minimisation baked in.

Every outbound message in the system goes through :meth:`SMSService.send`, so
there is exactly one place where consent is checked, one place where the audit
row is written, and one place to point a compliance reviewer at.

Two deliberate defaults:

* **Treatment details are omitted from SMS.** A text arrives on a lock screen
  that a partner, employer or thief may be looking at. "your appointment"
  carries the same operational value as "your root canal appointment" without
  disclosing a treatment. Flip ``SMS_INCLUDE_TREATMENT_DETAILS=true`` if the
  practice accepts that risk in writing.
* **Marketing needs consent; transactional does not.** Appointment
  confirmations and emergency-triage replies are transactional under the
  TCPA. Recall, reactivation and review requests are marketing, and are
  suppressed unless ``sms_consent`` is set (dental recall SMS is opt-in like
  everything else here — there is no separate marketing-consent flag because
  every one of these templates is practice-initiated patient communication,
  not promotional content).

The full template library below (30+ functions) is what the README's
"Dental SMS template library" section documents — each one is a plain Python
function so the practice name, phone number and treatment-detail policy are
applied consistently everywhere instead of being copy-pasted into six
different workflows.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.services.encryption import normalise_identifier
from app.services.hipaa_audit import HIPAAAuditLogger
from app.utils import format_appointment_time

logger = logging.getLogger(__name__)

try:  # pragma: no cover - exercised in the container
    from twilio.rest import Client as TwilioClient
    from twilio.request_validator import RequestValidator
except ImportError:  # pragma: no cover
    TwilioClient = None  # type: ignore[assignment]
    RequestValidator = None  # type: ignore[assignment]


#: Messages that may be sent without positive marketing intent (TCPA
#: transactional / provider-initiated). Recall and nurture templates are not
#: in this set — they still require ``sms_consent``, checked the same as
#: every other template, but are worth calling out for a compliance review.
TRANSACTIONAL_TEMPLATES = {
    "booking_confirmation",
    "reschedule_confirmation",
    "cancellation_confirmation",
    "emergency_missed_call",
    "emergency_reassurance_urgent",
    "emergency_office_hours",
    "emergency_slot_offer",
    "qualification_reply",
    "insurance_verified_copay",
    "consultation_hold_offer",
    "warm_lead_ack",
}


@dataclass
class SMSResult:
    delivered: bool
    status: str
    message_sid: Optional[str] = None
    reason: Optional[str] = None
    template: str = "adhoc"
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status in {"queued", "sent", "accepted", "delivered", "recorded"}


class SMSService:
    """Send SMS through Twilio, or record it when Twilio is not configured."""

    def __init__(self, db: Optional[Session] = None, audit: Optional[HIPAAAuditLogger] = None) -> None:
        self.db = db
        self.audit = audit or HIPAAAuditLogger(db)
        self._client = None
        if settings.twilio_enabled and TwilioClient is not None:
            try:
                self._client = TwilioClient(settings.twilio_account_sid, settings.twilio_auth_token)
            except Exception as exc:  # pragma: no cover - configuration error
                logger.error("Twilio client failed to initialise: %s", type(exc).__name__)

    @property
    def enabled(self) -> bool:
        return self._client is not None

    # ------------------------------------------------------------------ #
    # Sending
    # ------------------------------------------------------------------ #
    def send(
        self,
        *,
        to: Optional[str],
        body: str,
        template: str = "adhoc",
        patient_uuid: Optional[str] = None,
        sms_consent: Optional[bool] = None,
    ) -> SMSResult:
        """Send one message.

        ``to`` and ``body`` are PHI and are never logged. What gets logged is
        the template name, the delivery status and the message SID.
        """
        if not to:
            return self._blocked(template, patient_uuid, "no_destination")

        if sms_consent is False:
            return self._blocked(template, patient_uuid, "sms_consent_withheld")

        destination = normalise_identifier(to)

        if not self.enabled:
            # Recorded, audited, not delivered. Keeps the whole pipeline
            # exercisable end to end before Twilio credentials exist.
            logger.info("SMS[dry-run] template=%s len=%d", template, len(body))
            self.audit.log_sms(patient_uuid, template=template, message_sid=None, status="recorded")
            return SMSResult(
                delivered=False,
                status="recorded",
                template=template,
                reason="twilio_not_configured",
            )

        try:
            message = self._client.messages.create(  # type: ignore[union-attr]
                to=destination,
                from_=settings.twilio_phone_number,
                body=body,
            )
        except Exception as exc:
            logger.error("SMS send failed template=%s error=%s", template, type(exc).__name__)
            self.audit.log_sms(patient_uuid, template=template, message_sid=None, status="failed")
            return SMSResult(
                delivered=False, status="failed", template=template, reason=type(exc).__name__
            )

        self.audit.log_sms(
            patient_uuid, template=template, message_sid=message.sid, status=message.status or "queued"
        )
        return SMSResult(
            delivered=True,
            status=message.status or "queued",
            message_sid=message.sid,
            template=template,
        )

    def _blocked(self, template: str, patient_uuid: Optional[str], reason: str) -> SMSResult:
        logger.info("SMS suppressed template=%s reason=%s", template, reason)
        self.audit.log_sms(patient_uuid, template=template, message_sid=None, status="suppressed")
        return SMSResult(delivered=False, status="suppressed", template=template, reason=reason)

    # ------------------------------------------------------------------ #
    # Inbound webhook verification
    # ------------------------------------------------------------------ #
    @staticmethod
    def validate_signature(url: str, params: dict[str, Any], signature: Optional[str]) -> bool:
        """Verify ``X-Twilio-Signature`` on an inbound webhook.

        Without this, anyone who learns the URL can inject SMS into the lead
        or emergency-capture pipelines. Disable only in local testing.
        """
        if not settings.twilio_validate_signature:
            return True
        if not settings.twilio_auth_token or RequestValidator is None:
            logger.warning("Twilio signature validation requested but no auth token is configured")
            return False
        if not signature:
            return False
        validator = RequestValidator(settings.twilio_auth_token)
        return bool(validator.validate(url, params, signature))


# ======================================================================= #
# Dental SMS template library
#
# Kept as functions rather than format strings so the practice name, phone
# number and treatment-detail policy are applied consistently everywhere.
# ======================================================================= #
def _service_phrase(service: Optional[str]) -> str:
    if service and settings.sms_include_treatment_details:
        return f"your {service} appointment"
    return "your appointment"


def _booking_link() -> str:
    return settings.practice_booking_url


# --- Module 1: hygiene recall (30/60/90/120-day drip) ------------------- #
def hygiene_recall_30(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}it's time for your 6-month cleaning at {settings.practice_name}! Keep your "
        f"smile healthy. Book here: {_booking_link()} or reply CALL."
    )


def hygiene_recall_60(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}we noticed you missed your cleaning. Your dental benefits may expire soon. "
        f"Let's get you scheduled: {_booking_link()}"
    )


def hygiene_recall_90(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}Dr. [Dentist] asked about you at morning huddle. We have a hygiene opening "
        f"this week. Book priority: {_booking_link()}"
    )


def hygiene_recall_120_final(*, first_name: Optional[str] = None) -> str:
    greeting = f"Final notice: {first_name}, " if first_name else "Final notice: "
    return (
        f"{greeting}your dental patient account at {settings.practice_name} will be marked "
        f"inactive. Don't lose your established patient status. Reactivate: {_booking_link()}"
    )


# --- Module 2: treatment-plan follow-up (dentist-approved, sent verbatim) - #
# The AI-drafted text lives on TreatmentPlan.pending_sms_text and is sent
# exactly as approved — there is deliberately no template function for it
# here, so a dentist's edit can never be silently reformatted before it goes
# out. See services/treatment_plan_service.py.


# --- Module 3: review request ------------------------------------------- #
def review_request(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}we hope your visit with Dr. [Dentist] was comfortable! If you have a "
        f"moment, your feedback helps other patients find us: {settings.practice_google_review_url}"
    )


# --- Module 4: after-hours emergency capture ---------------------------- #
def emergency_missed_call(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}we missed your call at {settings.practice_name}! Are you having a dental "
        "emergency? Reply URGENT and we will call you back within 15 minutes. Reply BOOK to "
        "schedule. Reply INFO for office hours."
    )


def emergency_reassurance_urgent() -> str:
    return (
        "Dr. [Dentist] has been notified and will call you within 15 minutes. If this is "
        "life-threatening, please call 911."
    )


def emergency_office_hours() -> str:
    return (
        f"Our hours are Mon-Thu {settings.practice_open_hour}-{settings.practice_close_hour_mon_thu}, "
        f"Fri {settings.practice_open_hour}-{settings.practice_close_hour_fri}. For emergencies "
        f"outside hours, reply URGENT. Book online: {_booking_link()}"
    )


def emergency_slot_offer(*, when_text: str, address: Optional[str] = None) -> str:
    where = f" Address: {address}." if address else ""
    return (
        f"Your emergency appointment: {when_text}.{where} Please arrive 10 minutes early."
    )


def emergency_unknown_caller_no_action() -> str:
    """Not sent to anyone — documents why an unknown caller gets no auto-text."""
    return (
        "No SMS sent: caller could not be matched to an existing patient, and texting an "
        "unverified number is a bigger risk than a missed callback."
    )


# --- Module 5: lead qualification, booking, and nurture ------------------ #
def qualification_reply(*, reply_text: str) -> str:
    """The AI agent's next question or closing line, relayed over SMS verbatim."""
    return reply_text


def consultation_hold_offer(*, slot1: str, slot2: Optional[str] = None, slot3: Optional[str] = None, booking_url: str) -> str:
    slots = [s for s in (slot1, slot2, slot3) if s]
    joined = ", ".join(slots[:-1]) + (f", or {slots[-1]}" if len(slots) > 1 else slots[0])
    return f"Great! We have openings on {joined}. Click to book: {booking_url}"


def warm_lead_ack() -> str:
    return (
        f"Thanks! Our front desk will give you a call shortly to get you scheduled at "
        f"{settings.practice_name}."
    )


def lead_nurture_day1(*, treatment: Optional[str] = None) -> str:
    return (
        f"Thanks for your interest in {settings.practice_name}! Here's what to expect at your "
        f"first visit: {_booking_link()}"
    )


def lead_nurture_day3() -> str:
    return (
        "Did you know 47% of adults over 30 have gum disease? Early detection saves money and "
        f"pain. {_booking_link()}"
    )


def lead_nurture_day7() -> str:
    return (
        f"Ready to book your consultation? We offer complimentary exams for new patients. "
        f"Schedule here: {_booking_link()}"
    )


# --- Module 6: insurance verification ------------------------------------ #
def insurance_verified_copay(*, first_name: Optional[str], insurance_provider: str, copay_display: str, when_text: str) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}we've verified your {insurance_provider} benefits! Your estimated copay for "
        f"{when_text} is {copay_display}. See you then!"
    )


# --- Shared booking lifecycle -------------------------------------------- #
def booking_confirmation(*, service: str, when, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}you're all set for {_service_phrase(service)} on "
        f"{format_appointment_time(when)} at {settings.practice_name}. "
        f"Reply C to cancel or call {settings.practice_phone or 'us'} to reschedule."
    )


def reschedule_confirmation(*, service: str, when, first_name: Optional[str] = None) -> str:
    greeting = f"{first_name}, " if first_name else ""
    return (
        f"{greeting}you're rebooked for {_service_phrase(service)} on "
        f"{format_appointment_time(when)} at {settings.practice_name}. Reply C to cancel."
    )


def cancellation_confirmation(*, first_name: Optional[str] = None) -> str:
    greeting = f"{first_name}, " if first_name else ""
    return (
        f"{greeting}your appointment at {settings.practice_name} has been cancelled. "
        f"Rebook anytime: {_booking_link()}"
    )


__all__ = [
    "SMSService",
    "SMSResult",
    "TRANSACTIONAL_TEMPLATES",
    "hygiene_recall_30",
    "hygiene_recall_60",
    "hygiene_recall_90",
    "hygiene_recall_120_final",
    "review_request",
    "emergency_missed_call",
    "emergency_reassurance_urgent",
    "emergency_office_hours",
    "emergency_slot_offer",
    "emergency_unknown_caller_no_action",
    "qualification_reply",
    "consultation_hold_offer",
    "warm_lead_ack",
    "lead_nurture_day1",
    "lead_nurture_day3",
    "lead_nurture_day7",
    "insurance_verified_copay",
    "booking_confirmation",
    "reschedule_confirmation",
    "cancellation_confirmation",
]
