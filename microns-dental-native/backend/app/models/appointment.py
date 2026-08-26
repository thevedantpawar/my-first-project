"""A scheduled visit, plus the per-module state layered onto it.

Rather than one table per module reaching back to "the appointment", the
review-request and insurance-verification fields live directly on
``Appointment`` — there is exactly one row per visit either module cares
about, and the alternative (a join for every read) buys nothing. Treatment
plans get their own table (``treatment_plan.py``) because a single visit can
present a plan that then outlives several *other* visits during its
follow-up drip.
"""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import EncryptedString, EncryptedText, GUID
from app.utils import utcnow


class AppointmentStatus:
    PENDING = "pending"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    RESCHEDULED = "rescheduled"

    ACTIVE = (PENDING, CONFIRMED, RESCHEDULED)


class AppointmentSource:
    WEB = "web"
    VOICE = "voice"
    STAFF = "staff"
    BOOKING_SYSTEM = "booking_system"
    EMERGENCY = "emergency"
    CALENDLY = "calendly"


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    patient_id = Column(GUID, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)
    treatment_plan_id = Column(
        GUID, ForeignKey("treatment_plans.id", ondelete="SET NULL"), nullable=True, index=True
    )

    #: The Google Calendar event this appointment mirrors — set whenever a
    #: booking originates from (or is pushed to) Calendar, which is most of
    #: them, since Calendar is this system's primary trigger source.
    google_event_id = Column(String(200), nullable=True, index=True)
    google_calendar_id = Column(String(200), nullable=True)
    #: External PMS/Calendly reference, when the booking came from one of those.
    external_id = Column(String(120), nullable=True, index=True)

    service = Column(String(120), nullable=False)
    provider = Column(String(120), nullable=True)
    scheduled_for = Column(DateTime, nullable=False, index=True)
    duration_minutes = Column(Integer, default=30, nullable=False)
    status = Column(String(24), default=AppointmentStatus.PENDING, nullable=False, index=True)
    source = Column(String(24), default=AppointmentSource.STAFF, nullable=False)
    is_new_patient = Column(Boolean, default=False, nullable=False)

    completed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)

    # --- Module 1: hygiene recall (180-day drip) ----------------------------
    #: Only set on the completed hygiene visit that actually started a recall
    #: — most appointments have none of these populated.
    recall_status = Column(String(24), nullable=True, index=True)  # active|stopped_rebooked|inactive
    recall_stage = Column(String(16), nullable=True)  # due|30d_sent|60d_sent|90d_sent|120d_sent
    recall_due_date = Column(DateTime, nullable=True)
    recall_next_action_date = Column(DateTime, nullable=True, index=True)
    recall_tracking_event_id = Column(String(200), nullable=True)
    recall_tracking_calendar_id = Column(String(200), nullable=True)

    # --- Module 3: review request & response --------------------------------
    review_requested_at = Column(DateTime, nullable=True)
    review_received_at = Column(DateTime, nullable=True)
    review_next_check_at = Column(DateTime, nullable=True)
    #: Not PHI: a Google review's public star rating and its GBP resource id.
    review_star_rating = Column(Integer, nullable=True)
    google_review_id = Column(String(200), nullable=True)
    encrypted_review_text = Column(EncryptedText, nullable=True)
    review_response_drafted_at = Column(DateTime, nullable=True)
    review_response_posted_at = Column(DateTime, nullable=True)

    # --- Module 6: insurance verification ------------------------------------
    #: Plan name only, e.g. "Delta Dental PPO" — not PHI on its own.
    insurance_provider = Column(String(120), nullable=True)
    encrypted_member_id = Column(EncryptedString(512), nullable=True)
    insurance_verification_status = Column(String(24), nullable=True)  # pending | verified
    insurance_verified_at = Column(DateTime, nullable=True)
    insurance_annual_max_remaining_cents = Column(Integer, nullable=True)
    insurance_deductible_met = Column(Boolean, nullable=True)
    insurance_deductible_remaining_cents = Column(Integer, nullable=True)
    insurance_waiting_periods = Column(Boolean, nullable=True)
    insurance_copay_cents = Column(Integer, nullable=True)
    #: Coverage % for the four CDT codes the spec calls out, keyed by code.
    insurance_coverage_d0120_pct = Column(Integer, nullable=True)
    insurance_coverage_d1110_pct = Column(Integer, nullable=True)
    insurance_coverage_d4341_pct = Column(Integer, nullable=True)
    insurance_coverage_d2740_pct = Column(Integer, nullable=True)

    encrypted_notes = Column(EncryptedText, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    patient = relationship("Patient", back_populates="appointments", lazy="joined")
    treatment_plan = relationship("TreatmentPlan", back_populates="presenting_appointments", lazy="selectin")

    __table_args__ = (
        Index("ix_appointments_status_scheduled", "status", "scheduled_for"),
        Index("ix_appointments_review_next_check", "review_next_check_at"),
        Index("ix_appointments_recall_next_action", "recall_status", "recall_next_action_date"),
    )

    @property
    def is_active(self) -> bool:
        return self.status in AppointmentStatus.ACTIVE

    @property
    def member_id(self) -> Optional[str]:
        return self.encrypted_member_id

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Appointment id={self.id} service={self.service!r} status={self.status}>"
