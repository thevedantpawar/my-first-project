"""Appointments — the object the retention system revolves around."""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import EncryptedText, GUID, JSONColumn
from app.utils import utcnow


class AppointmentStatus:
    """Lifecycle of an appointment. Plain strings, not a DB enum.

    A native enum type would need a migration every time the clinic invents a
    new state; the constants below give the same readability at the call site
    with none of that cost.
    """

    PENDING = "pending"          # created by the voice agent, not yet confirmed
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    RESCHEDULED = "rescheduled"

    ALL = (PENDING, CONFIRMED, COMPLETED, CANCELLED, NO_SHOW, RESCHEDULED)
    #: States that still occupy a slot on the calendar.
    ACTIVE = (PENDING, CONFIRMED)


class AppointmentSource:
    VOICE = "voice"
    WEB = "web"
    SMS = "sms"
    STAFF = "staff"
    BOOKING_SYSTEM = "booking_system"


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    patient_id = Column(GUID, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)

    # Id in Acuity/Square/Mindbody, when an external system owns the calendar.
    external_id = Column(String(120), nullable=True, index=True)

    service = Column(String(120), nullable=False)
    provider = Column(String(120), nullable=True)
    scheduled_for = Column(DateTime, nullable=False, index=True)  # naive UTC
    duration_minutes = Column(Integer, default=30, nullable=False)
    status = Column(String(32), default=AppointmentStatus.PENDING, nullable=False, index=True)
    source = Column(String(32), default=AppointmentSource.VOICE, nullable=False)
    price_cents = Column(Integer, nullable=True)

    # Free-text clinical notes are PHI.
    encrypted_notes = Column("encrypted_notes", EncryptedText, nullable=True)

    # Retention bookkeeping — timestamps, never message content.
    reminder_24h_sent_at = Column(DateTime, nullable=True)
    reminder_2h_sent_at = Column(DateTime, nullable=True)
    review_requested_at = Column(DateTime, nullable=True)
    review_received_at = Column(DateTime, nullable=True)
    reactivation_sent_at = Column(DateTime, nullable=True)
    credit_offer_sent_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)

    extra = Column("metadata", JSONColumn, default=dict, nullable=False)

    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    patient = relationship("Patient", back_populates="appointments", lazy="joined")

    __table_args__ = (
        Index("ix_appointments_status_scheduled", "status", "scheduled_for"),
    )

    @property
    def is_active(self) -> bool:
        return self.status in AppointmentStatus.ACTIVE

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Appointment id={self.id} status={self.status} at={self.scheduled_for}>"
