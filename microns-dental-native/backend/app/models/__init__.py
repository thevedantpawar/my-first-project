"""SQLAlchemy column types and the model registry.

The two things that matter here:

``EncryptedText`` / ``EncryptedString``
    Transparent PHI encryption. Assign a plain Python string, and the value is
    encrypted on the way into the database and decrypted on the way out. No
    caller can forget to encrypt, because the column type does it.

``GUID`` / ``JSONColumn``
    Dialect-portable UUID and JSON so the same models run on PostgreSQL in
    production and SQLite in the test suite.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import CHAR, JSON, String, Text, TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

from app.services.encryption import get_encryption_service


class GUID(TypeDecorator):
    """UUID column: native ``uuid`` on PostgreSQL, ``CHAR(36)`` elsewhere."""

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PGUUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, uuid.UUID):
            value = uuid.UUID(str(value))
        if dialect.name == "postgresql":
            return value
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


class JSONColumn(TypeDecorator):
    """JSON column, upgraded to ``JSONB`` on PostgreSQL."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class _EncryptedMixin:
    """Shared encrypt-on-write / decrypt-on-read behaviour.

    The encryption service is resolved per call rather than captured at import
    time so that key rotation (and the test suite swapping keys) takes effect
    without rebuilding the mapper.
    """

    cache_ok = True

    def process_bind_param(self, value: Optional[Any], dialect) -> Optional[str]:
        if value is None or value == "":
            return None
        return get_encryption_service().encrypt(str(value))

    def process_result_value(self, value: Optional[str], dialect) -> Optional[str]:
        if value is None or value == "":
            return None
        return get_encryption_service().decrypt(value)


class EncryptedText(_EncryptedMixin, TypeDecorator):
    """Unbounded encrypted PHI — treatment history, transcripts, notes."""

    impl = Text
    cache_ok = True


class EncryptedString(_EncryptedMixin, TypeDecorator):
    """Bounded encrypted PHI — names, phone numbers, email addresses.

    ``length`` is the *ciphertext* budget, not the plaintext one: Fernet output
    is base64 and roughly ``4/3 * (57 + plaintext)`` bytes, so the 512 default
    comfortably holds any realistic name, phone or email.
    """

    impl = String
    cache_ok = True

    def __init__(self, length: int = 512, *args, **kwargs) -> None:
        super().__init__(length, *args, **kwargs)


# Model imports live at the bottom: they import the types defined above, and
# importing ``app.models`` must register every table on ``Base.metadata``.
from app.models.audit_log import AuditLog  # noqa: E402
from app.models.appointment import (  # noqa: E402
    Appointment,
    AppointmentSource,
    AppointmentStatus,
)
from app.models.emergency_call import EmergencyCall, EmergencyCallOutcome  # noqa: E402
from app.models.lead import Lead, LeadSource, LeadStatus, LeadTemperature  # noqa: E402
from app.models.patient import Patient  # noqa: E402
from app.models.retention_event import RetentionEvent, RetentionEventType  # noqa: E402
from app.models.treatment_plan import TreatmentPlan, TreatmentPlanStage, TreatmentPlanStatus  # noqa: E402
from app.models.voice_call import VoiceCall, VoiceCallOutcome  # noqa: E402

__all__ = [
    "GUID",
    "JSONColumn",
    "EncryptedText",
    "EncryptedString",
    "AuditLog",
    "Appointment",
    "AppointmentStatus",
    "AppointmentSource",
    "EmergencyCall",
    "EmergencyCallOutcome",
    "Lead",
    "LeadStatus",
    "LeadSource",
    "LeadTemperature",
    "Patient",
    "RetentionEvent",
    "RetentionEventType",
    "TreatmentPlan",
    "TreatmentPlanStage",
    "TreatmentPlanStatus",
    "VoiceCall",
    "VoiceCallOutcome",
]
