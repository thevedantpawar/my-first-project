"""Retention timeline: one row per touch the system makes with a patient."""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import GUID, JSONColumn
from app.utils import utcnow


class RetentionEventType:
    REMINDER_SENT = "reminder_sent"
    FINAL_REMINDER_SENT = "final_reminder_sent"
    NO_SHOW = "no_show"
    REACTIVATION_SENT = "reactivation_sent"
    CREDIT_OFFER_SENT = "credit_offer_sent"
    REVIEW_REQUESTED = "review_requested"
    REVIEW_RECEIVED = "review_received"
    REVIEW_RESPONSE_DRAFTED = "review_response_drafted"
    TREATMENT_COMPLETED = "treatment_completed"
    REBOOKED = "rebooked"
    NURTURE_SENT = "nurture_sent"

    ALL = (
        REMINDER_SENT,
        FINAL_REMINDER_SENT,
        NO_SHOW,
        REACTIVATION_SENT,
        CREDIT_OFFER_SENT,
        REVIEW_REQUESTED,
        REVIEW_RECEIVED,
        REVIEW_RESPONSE_DRAFTED,
        TREATMENT_COMPLETED,
        REBOOKED,
        NURTURE_SENT,
    )


class RetentionEvent(Base):
    __tablename__ = "retention_events"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    patient_id = Column(GUID, ForeignKey("patients.id", ondelete="CASCADE"), nullable=True, index=True)
    lead_id = Column(GUID, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    appointment_id = Column(
        GUID, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    event_type = Column(String(48), nullable=False, index=True)
    channel = Column(String(32), nullable=True)  # "sms", "voice", "email", "system"

    # NOTE: the attribute is `event_metadata` because `metadata` is reserved by
    # SQLAlchemy's declarative API — the *column* is still named `metadata`, so
    # the database schema matches the spec.
    event_metadata = Column("metadata", JSONColumn, default=dict, nullable=False)

    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    patient = relationship("Patient", lazy="noload")
    appointment = relationship("Appointment", lazy="noload")
    lead = relationship("Lead", back_populates="retention_events", lazy="noload")

    __table_args__ = (
        Index("ix_retention_type_created", "event_type", "created_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<RetentionEvent {self.event_type} at {self.created_at}>"
