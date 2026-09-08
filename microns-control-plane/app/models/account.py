"""An account: the organisation that owns one or more clinics.

Kept separate from ``User`` because the two genuinely differ. A med spa group
or an agency has several people who each need their own login and their own row
in the audit trail, but one subscription and one set of clinics.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import GUID
from app.utils import utcnow


class Account(Base):
    __tablename__ = "accounts"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    slug = Column(String(60), nullable=False, unique=True, index=True)

    #: Set by an operator, not self-serve. Grants the admin views that span
    #: every account, so it is deliberately not something signup can produce.
    is_staff = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    # Loaded on access rather than eagerly: the common path by far is a
    # session lookup, which needs the account's name and nothing else.
    users = relationship("User", back_populates="account", cascade="all, delete-orphan")
    clinics = relationship("Clinic", back_populates="account", cascade="all, delete-orphan")
    subscription = relationship(
        "Subscription",
        back_populates="account",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Account {self.slug}>"
