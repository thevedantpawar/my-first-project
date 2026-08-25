"""Inbound leads and their qualification state."""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import EncryptedString, GUID, JSONColumn
from app.services.encryption import get_encryption_service
from app.utils import utcnow


class LeadSource:
    WEBSITE_CHAT = "website_chat"
    SMS = "sms"
    PHONE = "phone"
    REFERRAL = "referral"


class LeadStatus:
    NEW = "new"
    QUALIFYING = "qualifying"
    QUALIFIED = "qualified"
    BOOKED = "booked"
    NURTURE = "nurture"
    DISQUALIFIED = "disqualified"


class LeadTemperature:
    HOT = "hot"       # 80-100 -> auto-book a consultation
    WARM = "warm"     # 50-79  -> CRM + staff follow-up within 24h
    COLD = "cold"     # 0-49   -> educational nurture drip


class Lead(Base):
    __tablename__ = "leads"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    source = Column(String(32), default=LeadSource.WEBSITE_CHAT, nullable=False, index=True)

    # --- PHI (encrypted) ---------------------------------------------------
    encrypted_phone = Column("encrypted_phone", EncryptedString(512), nullable=True)
    encrypted_email = Column("encrypted_email", EncryptedString(512), nullable=True)
    encrypted_name = Column("encrypted_name", EncryptedString(512), nullable=True)

    phone_fingerprint = Column(String(64), nullable=True, index=True)
    email_fingerprint = Column(String(64), nullable=True, index=True)

    # --- Qualification answers --------------------------------------------
    treatment_interest = Column(String(64), nullable=True)
    previous_experience = Column(Boolean, nullable=True)
    is_pregnant = Column(Boolean, nullable=True)
    blood_thinner = Column(Boolean, nullable=True)
    budget_range = Column(String(32), nullable=True)
    timeline = Column(String(32), nullable=True)

    # --- Outcome -----------------------------------------------------------
    qualification_score = Column(Integer, default=0, nullable=False)
    temperature = Column(String(16), nullable=True)
    status = Column(String(32), default=LeadStatus.NEW, nullable=False, index=True)
    next_action = Column(String(64), nullable=True)
    needs_provider_approval = Column(Boolean, default=False, nullable=False)
    medical_callback_required = Column(Boolean, default=False, nullable=False)
    calendly_event_id = Column(String(120), nullable=True)
    calendly_booking_url = Column(String(500), nullable=True)

    # Chat/SMS session key. Lets a browser or a phone number resume a
    # half-finished qualification without exposing the lead id publicly.
    session_id = Column(String(64), nullable=True, index=True, unique=True)

    # Conversation bookkeeping. Contains the current question and the
    # de-identified turn history — never raw names, phones or emails.
    conversation_state = Column(JSONColumn, default=dict, nullable=False)
    score_breakdown = Column(JSONColumn, default=dict, nullable=False)

    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    qualified_at = Column(DateTime, nullable=True)

    retention_events = relationship("RetentionEvent", back_populates="lead", lazy="selectin")

    __table_args__ = (
        Index("ix_leads_status_created", "status", "created_at"),
    )

    # ------------------------------------------------------------------ #
    @property
    def phone(self):
        return self.encrypted_phone

    @property
    def email(self):
        return self.encrypted_email

    @property
    def name(self):
        return self.encrypted_name

    def set_phone(self, phone) -> None:
        self.encrypted_phone = phone
        self.phone_fingerprint = get_encryption_service().fingerprint(phone)

    def set_email(self, email) -> None:
        self.encrypted_email = email
        self.email_fingerprint = get_encryption_service().fingerprint(email)

    def set_name(self, name) -> None:
        self.encrypted_name = name

    @property
    def answered_questions(self) -> int:
        return sum(
            1
            for value in (
                self.treatment_interest,
                self.previous_experience,
                self.is_pregnant,
                self.blood_thinner,
                self.budget_range,
                self.timeline,
            )
            if value is not None
        )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Lead id={self.id} status={self.status} score={self.qualification_score}>"
