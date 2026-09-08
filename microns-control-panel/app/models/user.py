"""A person who can sign in.

The engine authenticates staff with one shared token, which means its audit
trail records ``user_id: "staff"`` for everybody — no use at all in an access
review. Users here are the fix: each person has their own credential, and the
per-clinic staff token the engine receives is issued to a named user rather
than passed around.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import GUID
from app.utils import utcnow


class User(Base):
    __tablename__ = "users"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    account_id = Column(GUID, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)

    #: Stored lowercased. Unique across the whole system, not per account — an
    #: address that could sign in to two accounts makes "which one?" a prompt
    #: at every login.
    email = Column(String(320), nullable=False, unique=True, index=True)
    name = Column(String(200), nullable=True)

    #: Argon2id. The hash carries its own parameters, so raising the cost
    #: settings does not invalidate existing hashes — they are upgraded on the
    #: owner's next successful login.
    password_hash = Column(String(255), nullable=False)

    is_owner = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    last_login_at = Column(DateTime, nullable=True)
    #: Bumped on password change and on explicit "sign out everywhere".
    #: Sessions carry the value they were issued under, so a mismatch
    #: invalidates every cookie in circulation.
    session_epoch = Column(String(32), nullable=False, default=lambda: uuid.uuid4().hex[:16])

    #: Single-use, time-limited password reset. Only the hash is stored, so a
    #: leaked database does not hand over working reset links.
    reset_token_hash = Column(String(64), nullable=True, index=True)
    reset_token_expires_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account = relationship("Account", back_populates="users")

    __table_args__ = (Index("ix_users_account_email", "account_id", "email"),)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User {self.email}>"
