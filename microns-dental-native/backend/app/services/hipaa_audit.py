"""HIPAA audit logging.

Two destinations, on purpose:

1. The ``audit_logs`` table — queryable, joinable, what a compliance reviewer
   reads.
2. A structured ``AUDIT: {...}`` line on stdout — shipped to your log
   aggregator and durable even if the surrounding database transaction rolls
   back.

The one inviolable rule: **no PHI in either destination.** Records carry an
action, a hashed subject, and a data *category* — never a name, a number or a
message body.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.audit_log import AuditAction, AuditLog, DataCategory
from app.services.encryption import get_encryption_service
from app.utils import utcnow

logger = logging.getLogger("microns.audit")

#: Keys that must never appear in an audit ``details`` blob.
_PHI_KEYS = {"name", "phone", "email", "address", "dob", "transcript", "message", "body", "text"}


class HIPAAAuditLogger:
    """Write audit records for every touch of PHI.

    Usage::

        audit = HIPAAAuditLogger(db)
        audit.log_access("read", str(patient.id), "appointment", user_id="voice-agent")
    """

    def __init__(self, db: Optional[Session] = None, *, request_id: Optional[str] = None) -> None:
        self.db = db
        self.request_id = request_id

    # ------------------------------------------------------------------ #
    # Core
    # ------------------------------------------------------------------ #
    def log_access(
        self,
        action: str,
        patient_uuid: Optional[str],
        data_category: str,
        user_id: str = "system",
        *,
        outcome: str = "success",
        ip_address: Optional[str] = None,
        details: Optional[dict[str, Any]] = None,
    ) -> Optional[AuditLog]:
        details = _strip_phi(details or {})
        patient_uuid = str(patient_uuid) if patient_uuid else None
        subject_hash = get_encryption_service().pseudonymise(patient_uuid) if patient_uuid else None
        timestamp: datetime = utcnow()

        record = {
            "timestamp": timestamp.isoformat() + "Z",
            "action": action,
            "patient_uuid": patient_uuid,
            "subject_hash": subject_hash,
            "data_category": data_category,
            "user_id": user_id,
            "outcome": outcome,
            "request_id": self.request_id,
            "system": "microns-dental",
        }
        # Durable trail: emitted even if the DB write below is rolled back.
        logger.info("AUDIT: %s", json.dumps(record, default=str))

        if self.db is None:
            return None

        entry = AuditLog(
            timestamp=timestamp,
            action=action,
            patient_uuid=patient_uuid,
            subject_hash=subject_hash,
            data_category=data_category,
            user_id=user_id,
            outcome=outcome,
            request_id=self.request_id,
            ip_address=ip_address,
            details=details,
        )
        self.db.add(entry)
        # Flush rather than commit: the audit row joins the caller's
        # transaction so a failed business write cannot leave a misleading
        # "success" record behind. The stdout line above covers the case where
        # the transaction is later rolled back.
        self.db.flush()
        return entry

    # ------------------------------------------------------------------ #
    # Convenience wrappers for the events this system actually produces
    # ------------------------------------------------------------------ #
    def log_read(self, patient_uuid, data_category, user_id="system", **kwargs):
        return self.log_access(AuditAction.READ, patient_uuid, data_category, user_id, **kwargs)

    def log_write(self, patient_uuid, data_category, user_id="system", **kwargs):
        return self.log_access(AuditAction.WRITE, patient_uuid, data_category, user_id, **kwargs)

    def log_sms(self, patient_uuid, *, template: str, message_sid=None, status="queued", user_id="system"):
        return self.log_access(
            AuditAction.SMS_SENT,
            patient_uuid,
            DataCategory.PHONE,
            user_id,
            outcome=status,
            details={"template": template, "message_sid": message_sid},
        )

    def log_sms_received(self, patient_uuid, *, message_sid=None, user_id="twilio"):
        return self.log_access(
            AuditAction.SMS_RECEIVED,
            patient_uuid,
            DataCategory.PHONE,
            user_id,
            details={"message_sid": message_sid},
        )

    def log_llm_request(
        self,
        patient_uuid,
        *,
        purpose: str,
        model: str,
        deidentified: bool,
        token_count: Optional[int] = None,
        user_id: str = "system",
    ):
        """Record that PHI-adjacent text was sent to a third-party model.

        ``deidentified`` is the field an auditor will look at first, so it is
        recorded per call rather than assumed from configuration.
        """
        return self.log_access(
            AuditAction.LLM_REQUEST,
            patient_uuid,
            DataCategory.LEAD_QUALIFICATION,
            user_id,
            details={
                "purpose": purpose,
                "model": model,
                "deidentified": deidentified,
                "token_count": token_count,
                "vendor": "openai",
            },
        )

    def log_call(self, patient_uuid, *, action: str, call_id: Optional[str], outcome="success"):
        return self.log_access(
            action,
            patient_uuid,
            DataCategory.TRANSCRIPT,
            user_id="voice-agent",
            outcome=outcome,
            details={"call_id": call_id},
        )

    def log_calendar(self, patient_uuid, *, action: str, calendar_id: Optional[str], event_id: Optional[str]):
        """A Google Calendar create/update/delete against a tracking calendar."""
        return self.log_access(
            action,
            patient_uuid,
            DataCategory.APPOINTMENT,
            user_id="google-calendar",
            details={"calendar_id": calendar_id, "event_id": event_id},
        )

    def log_gmail_draft(self, patient_uuid, *, purpose: str, thread_id: Optional[str] = None):
        return self.log_access(
            AuditAction.WRITE,
            patient_uuid,
            DataCategory.EMAIL,
            user_id="gmail-service-account",
            details={"purpose": purpose, "thread_id": thread_id},
        )

    def log_denied(self, *, reason: str, ip_address=None, user_id="anonymous"):
        return self.log_access(
            AuditAction.ACCESS_DENIED,
            None,
            DataCategory.CONTACT,
            user_id,
            outcome="denied",
            ip_address=ip_address,
            details={"reason": reason},
        )


def _strip_phi(details: dict[str, Any]) -> dict[str, Any]:
    """Drop PHI-shaped keys and truncate anything unexpectedly long.

    Defensive rather than trusting: a caller that accidentally passes a message
    body should produce a redacted audit row, not a compliance incident.
    """
    clean: dict[str, Any] = {}
    for key, value in details.items():
        if str(key).lower() in _PHI_KEYS:
            clean[f"{key}_redacted"] = True
            continue
        if isinstance(value, str) and len(value) > 200:
            clean[key] = value[:200] + "…[truncated]"
        else:
            clean[key] = value
    return clean


def audit_for(db: Optional[Session] = None, request_id: Optional[str] = None) -> HIPAAAuditLogger:
    return HIPAAAuditLogger(db, request_id=request_id)


__all__ = ["HIPAAAuditLogger", "audit_for", "AuditAction", "DataCategory"]
