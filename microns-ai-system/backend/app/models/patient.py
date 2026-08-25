"""Patient record. Every identifying field is encrypted at rest."""

from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from sqlalchemy import Boolean, Column, DateTime, Index, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import EncryptedString, EncryptedText, GUID
from app.services.encryption import get_encryption_service
from app.utils import utcnow


class Patient(Base):
    """A patient of the clinic.

    Name, phone, email and treatment history are PHI and are stored encrypted.
    Because Fernet ciphertext is non-deterministic, lookups go through the
    ``*_fingerprint`` columns — a keyed HMAC of the normalised identifier.
    """

    __tablename__ = "patients"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)

    # --- PHI (encrypted) ---------------------------------------------------
    encrypted_name = Column("encrypted_name", EncryptedString(512), nullable=True)
    encrypted_phone = Column("encrypted_phone", EncryptedString(512), nullable=False)
    encrypted_email = Column("encrypted_email", EncryptedString(512), nullable=True)
    encrypted_treatment_history = Column("encrypted_treatment_history", EncryptedText, nullable=True)
    encrypted_notes = Column("encrypted_notes", EncryptedText, nullable=True)

    # --- Deterministic lookup keys (one-way, not reversible) ---------------
    phone_fingerprint = Column(String(64), nullable=False, index=True, unique=True)
    email_fingerprint = Column(String(64), nullable=True, index=True)

    # --- Non-PHI operational fields ---------------------------------------
    sms_consent = Column(Boolean, default=False, nullable=False)
    marketing_consent = Column(Boolean, default=False, nullable=False)
    preferred_provider = Column(String(120), nullable=True)
    external_id = Column(String(120), nullable=True, index=True)  # booking-system id
    last_visit_at = Column(DateTime, nullable=True, index=True)
    reactivation_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    appointments = relationship(
        "Appointment", back_populates="patient", cascade="all, delete-orphan", lazy="selectin"
    )
    voice_calls = relationship("VoiceCall", back_populates="patient", lazy="selectin")

    __table_args__ = (Index("ix_patients_last_visit", "last_visit_at"),)

    # ------------------------------------------------------------------ #
    # Convenience accessors — these return plaintext PHI. Never log them.
    # ------------------------------------------------------------------ #
    @property
    def name(self) -> Optional[str]:
        return self.encrypted_name

    @property
    def phone(self) -> Optional[str]:
        return self.encrypted_phone

    @property
    def email(self) -> Optional[str]:
        return self.encrypted_email

    @property
    def treatment_history(self) -> list[dict[str, Any]]:
        if not self.encrypted_treatment_history:
            return []
        try:
            data = json.loads(self.encrypted_treatment_history)
        except (TypeError, ValueError):
            return []
        return data if isinstance(data, list) else []

    def set_treatment_history(self, history: list[dict[str, Any]]) -> None:
        self.encrypted_treatment_history = json.dumps(history)

    def append_treatment(self, entry: dict[str, Any]) -> None:
        history = self.treatment_history
        history.append(entry)
        self.set_treatment_history(history)

    # ------------------------------------------------------------------ #
    # Construction / lookup
    # ------------------------------------------------------------------ #
    @classmethod
    def create(
        cls,
        *,
        phone: str,
        name: Optional[str] = None,
        email: Optional[str] = None,
        sms_consent: bool = False,
        **kwargs: Any,
    ) -> "Patient":
        """Build a patient with fingerprints populated consistently."""
        service = get_encryption_service()
        return cls(
            encrypted_phone=phone,
            encrypted_name=name,
            encrypted_email=email,
            phone_fingerprint=service.fingerprint(phone),
            email_fingerprint=service.fingerprint(email),
            sms_consent=sms_consent,
            **kwargs,
        )

    def set_phone(self, phone: str) -> None:
        self.encrypted_phone = phone
        self.phone_fingerprint = get_encryption_service().fingerprint(phone)

    def set_email(self, email: Optional[str]) -> None:
        self.encrypted_email = email
        self.email_fingerprint = get_encryption_service().fingerprint(email)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        # Deliberately identifier-free: repr() ends up in logs and tracebacks.
        return f"<Patient id={self.id}>"
