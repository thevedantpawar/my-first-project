"""Who did what in the control panel.

This is not the engine's HIPAA trail — no PHI passes through here. It is the
administrative record: who signed in, who provisioned or suspended a clinic,
who read an escrowed encryption key. That last one matters most. Retrieving a
clinic's encryption key is the single most sensitive action the product
supports, and it must never be possible to do it without leaving a row.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import GUID, JSONColumn
from app.utils import utcnow


class AuditAction:
    LOGIN = "login"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    SIGNUP = "signup"
    PASSWORD_RESET_REQUESTED = "password_reset_requested"
    PASSWORD_CHANGED = "password_changed"
    CLINIC_CREATED = "clinic_created"
    CLINIC_PROVISIONED = "clinic_provisioned"
    CLINIC_SUSPENDED = "clinic_suspended"
    CLINIC_RESUMED = "clinic_resumed"
    CLINIC_DEPROVISIONED = "clinic_deprovisioned"
    #: Reading a clinic's escrowed encryption key.
    KEY_REVEALED = "key_revealed"
    #: Reading the sign-in credentials handed to a clinic.
    CREDENTIALS_REVEALED = "credentials_revealed"
    #: Rotating the staff token, which signs the clinic out everywhere.
    CREDENTIALS_ROTATED = "credentials_rotated"
    CUSTOM_DOMAIN_ATTACHED = "custom_domain_attached"
    SUBSCRIPTION_CHANGED = "subscription_changed"
    ACCESS_DENIED = "access_denied"


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)

    action = Column(String(48), nullable=False, index=True)
    outcome = Column(String(24), nullable=False, default="success")

    #: Nullable so a failed login — where there may be no matching user — is
    #: still recorded. That is the row an access review most wants.
    actor_user_id = Column(GUID, nullable=True, index=True)
    actor_email = Column(String(320), nullable=True)
    account_id = Column(GUID, nullable=True, index=True)
    clinic_id = Column(GUID, nullable=True, index=True)

    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(400), nullable=True)
    request_id = Column(String(64), nullable=True, index=True)

    #: Structured context. Never a secret, never a token — the point of this
    #: table is to record that a secret was accessed, not to hold another copy.
    details = Column(JSONColumn, nullable=False, default=dict)

    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    __table_args__ = (
        Index("ix_audit_action_created", "action", "created_at"),
        Index("ix_audit_account_created", "account_id", "created_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<AuditEvent {self.action} {self.outcome}>"
