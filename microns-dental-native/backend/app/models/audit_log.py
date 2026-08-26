"""HIPAA audit trail.

§164.312(b) requires a record of activity in systems that hold ePHI. This table
is that record, and it is deliberately **not** encrypted: it must stay readable
for a compliance review, which is only safe because it contains no PHI. Rows
hold a hashed subject id and a data *category* — never the data itself.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, String
from sqlalchemy.orm import validates

from app.database import Base
from app.models import GUID, JSONColumn
from app.utils import utcnow


class AuditAction:
    READ = "read"
    WRITE = "write"
    UPDATE = "update"
    DELETE = "delete"
    SMS_SENT = "sms_sent"
    SMS_RECEIVED = "sms_received"
    CALL_STARTED = "call_started"
    CALL_ENDED = "call_ended"
    LLM_REQUEST = "llm_request"
    EXPORT = "export"
    LOGIN = "login"
    ACCESS_DENIED = "access_denied"


class DataCategory:
    APPOINTMENT = "appointment"
    PHONE = "phone"
    NAME = "name"
    EMAIL = "email"
    TRANSCRIPT = "transcript"
    TREATMENT_HISTORY = "treatment_history"
    TREATMENT_PLAN = "treatment_plan"
    INSURANCE = "insurance"
    LEAD_QUALIFICATION = "lead_qualification"
    CONTACT = "contact"
    DASHBOARD = "dashboard"


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    timestamp = Column(DateTime, default=utcnow, nullable=False, index=True)

    action = Column(String(48), nullable=False, index=True)
    #: Random record UUID. Not PHI on its own, and the join key an auditor needs.
    patient_uuid = Column(String(64), nullable=True, index=True)
    #: Keyed HMAC of the subject id — correlates rows across systems without
    #: exposing the identifier itself.
    subject_hash = Column(String(64), nullable=True, index=True)
    data_category = Column(String(48), nullable=False)
    user_id = Column(String(120), default="system", nullable=False)
    source_system = Column(String(64), default="microns-dental", nullable=False)
    request_id = Column(String(64), nullable=True, index=True)
    ip_address = Column(String(64), nullable=True)
    outcome = Column(String(32), default="success", nullable=False)
    #: Non-PHI context only: counts, durations, model names, message SIDs.
    details = Column(JSONColumn, default=dict, nullable=False)

    __table_args__ = (
        Index("ix_audit_patient_time", "patient_uuid", "timestamp"),
        Index("ix_audit_action_time", "action", "timestamp"),
    )

    @validates("details")
    def _reject_phi_shaped_details(self, _key, value):
        """Last line of defence against PHI leaking into the audit trail.

        A developer adding ``details={"phone": ...}`` to a log call is the most
        likely way this table ever gets contaminated, so the model rejects the
        obvious key names outright.
        """
        if not value:
            return {}
        banned = {"name", "phone", "email", "address", "dob", "transcript", "message", "body"}
        offenders = sorted(banned.intersection({str(k).lower() for k in value}))
        if offenders:
            raise ValueError(
                f"Audit details may not contain PHI-shaped keys: {', '.join(offenders)}"
            )
        return value

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<AuditLog {self.action} {self.data_category} at {self.timestamp}>"
