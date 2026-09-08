"""Control-plane models and the custom column types they share."""

from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from sqlalchemy import CHAR, Text, TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID


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
    """JSON column: ``jsonb`` on PostgreSQL, serialised text elsewhere."""

    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value: Any, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return value
        return json.dumps(value, default=str)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return value
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return {}


class SealedString(TypeDecorator):
    """A secret, encrypted at rest under the control plane's master key.

    Reads and writes look like an ordinary string column; the sealing happens
    here so no caller can forget it. See ``services/crypto.py`` for why these
    values are held at all.

    The ciphertext is Fernet, which is non-deterministic — the same plaintext
    seals differently each time — so a sealed column can never be used in a
    ``WHERE`` clause. Look rows up by an id or a fingerprint instead.
    """

    impl = Text
    cache_ok = False

    def process_bind_param(self, value: Optional[str], dialect) -> Optional[str]:
        if value is None:
            return None
        from app.services.crypto import get_sealer

        return get_sealer().seal(value)

    def process_result_value(self, value: Optional[str], dialect) -> Optional[str]:
        if value is None:
            return None
        from app.services.crypto import get_sealer

        return get_sealer().unseal(value)


from app.models.account import Account  # noqa: E402
from app.models.audit_event import AuditEvent  # noqa: E402
from app.models.clinic import Clinic, ClinicStatus  # noqa: E402
from app.models.provisioning_event import ProvisioningEvent, ProvisioningStep  # noqa: E402
from app.models.subscription import Subscription, SubscriptionStatus  # noqa: E402
from app.models.user import User  # noqa: E402

__all__ = [
    "GUID",
    "JSONColumn",
    "SealedString",
    "Account",
    "AuditEvent",
    "Clinic",
    "ClinicStatus",
    "ProvisioningEvent",
    "ProvisioningStep",
    "Subscription",
    "SubscriptionStatus",
    "User",
]
