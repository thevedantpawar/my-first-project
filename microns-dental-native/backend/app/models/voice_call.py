"""Voice call records from the VAPI agent."""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import EncryptedText, GUID, JSONColumn
from app.utils import utcnow


class VoiceCallOutcome:
    IN_PROGRESS = "in_progress"
    BOOKED = "booked"
    RESCHEDULED = "rescheduled"
    CANCELLED = "cancelled"
    FAQ = "faq"
    TRANSFERRED = "transferred"
    CALLBACK_REQUESTED = "callback_requested"
    EMERGENCY_ESCALATED = "emergency_escalated"
    VOICEMAIL = "voicemail"
    ABANDONED = "abandoned"


class VoiceCall(Base):
    __tablename__ = "voice_calls"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    vapi_call_id = Column(String(120), index=True, nullable=True)
    patient_id = Column(GUID, ForeignKey("patients.id", ondelete="SET NULL"), nullable=True, index=True)
    appointment_id = Column(
        GUID, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # The transcript is dense PHI: symptoms, medications, names. Encrypted.
    transcript = Column(EncryptedText, nullable=True)
    # Caller ID is PHI too.
    encrypted_caller_number = Column("encrypted_caller_number", EncryptedText, nullable=True)
    caller_fingerprint = Column(String(64), nullable=True, index=True)

    call_duration = Column(Integer, nullable=True)  # seconds
    outcome = Column(String(32), default=VoiceCallOutcome.IN_PROGRESS, nullable=False, index=True)
    ended_reason = Column(String(64), nullable=True)
    #: Non-PHI call context: intents hit, slots offered, transfer reason.
    summary = Column(JSONColumn, default=dict, nullable=False)

    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    ended_at = Column(DateTime, nullable=True)

    patient = relationship("Patient", back_populates="voice_calls", lazy="joined")

    __table_args__ = (
        Index("ix_voice_calls_outcome_created", "outcome", "created_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<VoiceCall id={self.id} outcome={self.outcome}>"
