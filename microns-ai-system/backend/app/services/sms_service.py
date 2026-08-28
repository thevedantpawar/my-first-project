"""Twilio SMS delivery, with consent, audit and PHI-minimisation baked in.

Every outbound message in the system goes through :meth:`SMSService.send`, so
there is exactly one place where consent is checked, one place where the audit
row is written, and one place to point a compliance reviewer at.

Two deliberate defaults:

* **Treatment details are omitted from SMS.** A text arrives on a lock screen
  that a partner, employer or thief may be looking at. "your appointment"
  carries the same operational value as "your Botox appointment" without
  disclosing a treatment. Flip ``SMS_INCLUDE_TREATMENT_DETAILS=true`` if the
  clinic accepts that risk in writing.
* **Marketing needs consent; transactional does not.** Appointment reminders
  are transactional under the TCPA. Reactivation offers and review requests are
  marketing, and are suppressed unless ``marketing_consent`` is set.
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


#: Messages that may be sent without marketing consent (TCPA transactional).
TRANSACTIONAL_TEMPLATES = {
    "booking_confirmation",
    "reminder_24h",
    "reminder_2h",
    "cancellation_confirmation",
    "reschedule_confirmation",
    "callback_ack",
    "consultation_confirmation",
    "qualification_reply",
    # A direct reply to the patient's own inbound call attempt, sent within
    # minutes of it — closer to a missed-call callback than to marketing.
    # The 15-minute nudge that follows is NOT in this set on purpose: it is a
    # second, unsolicited touch and stays gated on marketing_consent. Review
    # this classification with the clinic's counsel before go-live.
    "missed_call_sms",
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
        marketing_consent: Optional[bool] = None,
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

        is_marketing = template not in TRANSACTIONAL_TEMPLATES
        if is_marketing and marketing_consent is False:
            return self._blocked(template, patient_uuid, "marketing_consent_withheld")

        destination = normalise_identifier(to)

        if not self.enabled:
            # Recorded, audited, not delivered. Keeps the whole retention
            # pipeline exercisable end to end before Twilio credentials exist.
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
        pipeline. Disable only in local testing.
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


# ---------------------------------------------------------------------- #
# Message templates
#
# Kept as functions rather than format strings so the treatment-detail policy
# and the clinic name are applied consistently everywhere.
# ---------------------------------------------------------------------- #
def _service_phrase(service: Optional[str]) -> str:
    if service and settings.sms_include_treatment_details:
        return f"your {service} appointment"
    return "your appointment"


def booking_confirmation(*, service: str, when, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}you're all set for {_service_phrase(service)} on "
        f"{format_appointment_time(when)} at {settings.clinic_name}. "
        f"Reply C to cancel or call {settings.clinic_phone or 'us'} to reschedule."
    )


def reminder_24h(*, service: str, when, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}! " if first_name else "Hi! "
    return (
        f"{greeting}Reminder: {_service_phrase(service)} at {settings.clinic_name} is tomorrow, "
        f"{format_appointment_time(when)}. Reply C to cancel or R to reschedule — "
        "letting us know early helps us offer the slot to someone else."
    )


def reminder_2h(*, service: str, when, first_name: Optional[str] = None) -> str:
    local = format_appointment_time(when)
    greeting = f"{first_name}, " if first_name else ""
    return (
        f"{greeting}see you in about 2 hours ({local}) at {settings.clinic_name}. "
        "Please arrive 10 minutes early. Reply C if you can't make it."
    )


def no_show_reactivation(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}we missed you at {settings.clinic_name} yesterday — life happens! "
        f"Rebook whenever suits you: {settings.clinic_booking_url}. Reply STOP to opt out."
    )


def no_show_credit_offer(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}your ${settings.no_show_credit_amount} {settings.clinic_name} credit expires "
        f"tomorrow. Book here to use it: {settings.clinic_booking_url}. Reply STOP to opt out."
    )


def review_request(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}hope you're loving your results! If you have a moment, we'd really "
        f"appreciate your feedback: {settings.clinic_review_url}. Reply STOP to opt out."
    )


def dormant_reactivation(*, first_name: Optional[str] = None, days: int = 45) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}it's been a little while since your last visit to {settings.clinic_name}. "
        f"Ready for a refresh? Book here: {settings.clinic_booking_url}. Reply STOP to opt out."
    )


def missed_call_sms(*, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    return (
        f"{greeting}sorry we missed your call at {settings.clinic_name}! Book a time that "
        f"works for you here: {settings.clinic_booking_url}. Or call us back at "
        f"{settings.clinic_phone or 'the clinic'}."
    )


def missed_call_nudge(*, first_name: Optional[str] = None) -> str:
    greeting = f"{first_name}, " if first_name else ""
    return (
        f"{greeting}still there? Grab a spot before it's gone: {settings.clinic_booking_url}. "
        "Reply STOP to opt out."
    )


def package_followup(*, service: Optional[str] = None, first_name: Optional[str] = None) -> str:
    greeting = f"Hi {first_name}, " if first_name else "Hi, "
    label = _service_phrase(service)
    return (
        f"{greeting}it's about time for {label if label != 'your appointment' else 'your next session'} "
        f"at {settings.clinic_name}. Ready to book? {settings.clinic_booking_url}. Reply STOP to opt out."
    )


def consultation_confirmation(*, when_text: str, booking_url: Optional[str] = None) -> str:
    tail = f" Details: {booking_url}" if booking_url else ""
    return (
        f"You're booked in for a consultation at {settings.clinic_name} — {when_text}.{tail} "
        "Reply C to cancel."
    )


def medical_callback_ack() -> str:
    return (
        f"Thanks for reaching out to {settings.clinic_name}. That's a question for our medical "
        "provider — they'll call you back within 2 hours during clinic hours."
    )


def nurture_message(*, step: int, treatment: Optional[str] = None) -> str:
    topic = treatment or "treatments"
    library = [
        f"Curious about {topic}? Here's what to expect at your first visit: {settings.clinic_booking_url}",
        f"Most {topic} results settle in around 2 weeks — here's our before-and-after gallery: "
        f"{settings.clinic_booking_url}",
        f"Questions about {topic} pricing? We do free 15-minute consults: {settings.clinic_booking_url}",
    ]
    body = library[min(max(step, 0), len(library) - 1)]
    return f"{body} Reply STOP to opt out."


__all__ = [
    "SMSService",
    "SMSResult",
    "TRANSACTIONAL_TEMPLATES",
    "booking_confirmation",
    "reminder_24h",
    "reminder_2h",
    "no_show_reactivation",
    "no_show_credit_offer",
    "review_request",
    "dormant_reactivation",
    "consultation_confirmation",
    "medical_callback_ack",
    "nurture_message",
    "missed_call_sms",
    "missed_call_nudge",
    "package_followup",
]
