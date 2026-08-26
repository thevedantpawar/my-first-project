"""Module 4 — a pending after-hours missed-call case.

Tracks one missed call from ring to resolution: the SMS offering URGENT /
BOOK / INFO was sent, and this row is what the inbound-reply webhook matches
the patient's next text back to.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import EncryptedText, GUID
from app.utils import utcnow


class EmergencyCallOutcome:
    PENDING_REPLY = "pending_reply"
    URGENT_ESCALATED = "urgent_escalated"
    BOOKED = "booked"
    INFO_SENT = "info_sent"
    UNRECOGNIZED_REPLY = "unrecognized_reply"
    NO_REPLY = "no_reply"


class EmergencyCall(Base):
    __tablename__ = "emergency_calls"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    patient_id = Column(GUID, ForeignKey("patients.id", ondelete="SET NULL"), nullable=True, index=True)
    #: Set for a caller we could not match to an existing patient — logged,
    #: never auto-texted (see ``services/emergency_service.py``).
    phone_fingerprint = Column(String(64), nullable=True, index=True)

    outcome = Column(String(24), default=EmergencyCallOutcome.PENDING_REPLY, nullable=False, index=True)
    reply_keyword = Column(String(16), nullable=True)
    on_call_calendar_id = Column(String(200), nullable=True)
    on_call_event_id = Column(String(200), nullable=True)
    emergency_appointment_id = Column(GUID, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True)
    #: Non-PHI context: which keywords were offered, timing — never the call content.
    encrypted_notes = Column(EncryptedText, nullable=True)

    received_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    resolved_at = Column(DateTime, nullable=True)

    patient = relationship("Patient", viewonly=True)

    __table_args__ = (Index("ix_emergency_calls_phone_outcome", "phone_fingerprint", "outcome"),)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<EmergencyCall id={self.id} outcome={self.outcome}>"
