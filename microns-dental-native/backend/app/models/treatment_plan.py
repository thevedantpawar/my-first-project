"""A presented-but-unscheduled treatment plan and its follow-up drip.

Module 2 of the spec: a consultation ends with the plan unscheduled, and this
row tracks it through a 1/3/7/14/30-day approval-gated SMS drip until the
patient books (``CONVERTED``) or the drip runs out (``EXPIRED``). The state
machine lives here instead of a chain of 30-day ``Wait`` steps so a container
restart never loses a patient's place in the sequence — a daily job reads
``next_action_date <= now`` the same way the n8n version of this workflow
reads its Data Table.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import EncryptedText, GUID, JSONColumn
from app.utils import utcnow


class TreatmentPlanStage:
    """Each value names the message that was *most recently sent*.

    ``DAY14_SENT`` is terminal: it is reached only once the Day-30 (final)
    message has been approved and sent, at which point the plan is marked
    ``EXPIRED`` rather than advanced further — see
    :meth:`TreatmentPlanService.approve_by_tag`.
    """

    PRESENTED = "presented"
    DAY1_SENT = "day1_sent"
    DAY3_SENT = "day3_sent"
    DAY7_SENT = "day7_sent"
    DAY14_SENT = "day14_sent"

    ORDER = [PRESENTED, DAY1_SENT, DAY3_SENT, DAY7_SENT, DAY14_SENT]
    #: Day offset (from presentation) that each stage's SMS goes out at.
    OFFSET_DAYS = {PRESENTED: 1, DAY1_SENT: 3, DAY3_SENT: 7, DAY7_SENT: 14, DAY14_SENT: 30}

    @classmethod
    def next_stage(cls, stage: str) -> Optional[str]:
        """The stage reached after approving ``stage``'s drafted message.

        ``None`` means the message just approved was the final (Day-30) one —
        the caller should mark the plan ``EXPIRED``, not advance it.
        """
        try:
            index = cls.ORDER.index(stage)
        except ValueError:
            return None
        return cls.ORDER[index + 1] if index + 1 < len(cls.ORDER) else None


class TreatmentPlanStatus:
    ACTIVE = "active"
    AWAITING_APPROVAL = "awaiting_approval"
    CONVERTED = "converted"
    EXPIRED = "expired"


class TreatmentPlan(Base):
    __tablename__ = "treatment_plans"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    patient_id = Column(GUID, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True)

    #: Non-PHI: CDT codes and dollar amounts, no patient-identifying text.
    procedures = Column(JSONColumn, default=list, nullable=False)
    total_value_cents = Column(Integer, nullable=False, default=0)

    presentation_date = Column(DateTime, nullable=False)
    scheduled_date = Column(DateTime, nullable=True)
    converted_at = Column(DateTime, nullable=True)
    expired_at = Column(DateTime, nullable=True)

    stage = Column(String(24), default=TreatmentPlanStage.PRESENTED, nullable=False, index=True)
    status = Column(String(24), default=TreatmentPlanStatus.ACTIVE, nullable=False, index=True)
    next_action_date = Column(DateTime, nullable=True, index=True)
    followup_count = Column(Integer, default=0, nullable=False)

    #: The AI-drafted SMS awaiting the dentist's forward/reply approval. It is
    #: sent *verbatim* on approval — never regenerated — so it is stored
    #: exactly as drafted, which is why it is treated as PHI (it can quote the
    #: treatment and the patient's name back).
    encrypted_pending_sms_text = Column(EncryptedText, nullable=True)

    #: The Google Calendar tracking event mirroring this plan's next action.
    google_tracking_event_id = Column(String(200), nullable=True)
    google_tracking_calendar_id = Column(String(200), nullable=True)

    #: Subject-tag id used to match a dentist's forwarded-email approval back
    #: to this row — see ``services/treatment_plan_service.py``.
    approval_tag = Column(String(64), nullable=True, index=True, unique=True)

    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    presenting_appointments = relationship("Appointment", back_populates="treatment_plan", lazy="selectin")

    __table_args__ = (Index("ix_tp_status_next_action", "status", "next_action_date"),)

    @property
    def pending_sms_text(self) -> Optional[str]:
        return self.encrypted_pending_sms_text

    def set_pending_sms_text(self, text: Optional[str]) -> None:
        self.encrypted_pending_sms_text = text

    def as_dict(self) -> dict[str, Any]:
        return {
            "treatment_plan_id": str(self.id),
            "stage": self.stage,
            "status": self.status,
            "total_value_cents": self.total_value_cents,
            "next_action_date": self.next_action_date.isoformat() + "Z" if self.next_action_date else None,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<TreatmentPlan id={self.id} stage={self.stage} status={self.status}>"
