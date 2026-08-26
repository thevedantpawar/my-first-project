"""A timestamped log of what each module actually did.

One shared table rather than one per module: every module here follows the
same shape (something happened, to some patient/appointment/lead/treatment
plan, over some channel) and a single ``/retention/events/{patient_uuid}``
endpoint can show a front-desk staffer the whole timeline — a recall text,
a review request, a treatment-plan nudge — in one place.
"""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import Column, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import GUID, JSONColumn
from app.utils import utcnow


class RetentionEventType:
    # Module 1 — hygiene recall
    RECALL_STARTED = "recall_started"
    RECALL_SMS_SENT = "recall_sms_sent"
    RECALL_STOPPED_REBOOKED = "recall_stopped_rebooked"
    RECALL_MARKED_INACTIVE = "recall_marked_inactive"
    # Module 2 — treatment plan follow-up
    TP_STARTED = "tp_started"
    TP_SMS_DRAFTED = "tp_sms_drafted"
    TP_SMS_APPROVED_SENT = "tp_sms_approved_sent"
    TP_CONVERTED = "tp_converted"
    TP_EXPIRED = "tp_expired"
    # Module 3 — review request & response
    REVIEW_REQUESTED = "review_requested"
    REVIEW_RECEIVED = "review_received"
    REVIEW_RESPONSE_DRAFTED = "review_response_drafted"
    REVIEW_RESPONSE_POSTED = "review_response_posted"
    # Module 4 — after-hours emergency capture
    EMERGENCY_MISSED_CALL_TEXTED = "emergency_missed_call_texted"
    EMERGENCY_ESCALATED_URGENT = "emergency_escalated_urgent"
    EMERGENCY_SLOT_BOOKED = "emergency_slot_booked"
    EMERGENCY_INFO_SENT = "emergency_info_sent"
    # Module 5 — lead qualification
    LEAD_QUALIFIED = "lead_qualified"
    LEAD_NURTURE_SENT = "lead_nurture_sent"
    # Module 6 — insurance verification
    INSURANCE_REQUEST_SENT = "insurance_request_sent"
    INSURANCE_VERIFIED = "insurance_verified"


class RetentionEvent(Base):
    __tablename__ = "retention_events"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_type = Column(String(48), nullable=False, index=True)
    patient_id = Column(GUID, ForeignKey("patients.id", ondelete="CASCADE"), nullable=True, index=True)
    appointment_id = Column(
        GUID, ForeignKey("appointments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    treatment_plan_id = Column(
        GUID, ForeignKey("treatment_plans.id", ondelete="CASCADE"), nullable=True, index=True
    )
    lead_id = Column(GUID, ForeignKey("leads.id", ondelete="CASCADE"), nullable=True, index=True)

    channel = Column(String(24), default="sms", nullable=False)  # sms|email|calendar|system|voice
    #: Non-PHI only: SMS status, template name, stage transitions, links.
    event_metadata = Column(JSONColumn, default=dict, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    patient = relationship("Patient", viewonly=True)
    lead = relationship("Lead", back_populates="retention_events", lazy="joined")

    __table_args__ = (
        Index("ix_retention_events_patient_time", "patient_id", "created_at"),
        Index("ix_retention_events_type_time", "event_type", "created_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<RetentionEvent {self.event_type} at {self.created_at}>"
