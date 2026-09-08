"""What the account pays, and whether it is currently paid up.

Stripe is the source of truth for billing state; this row is a local cache of
it, updated by webhook. Nothing here decides what Stripe charges — it decides
whether a clinic's engine keeps serving traffic, which has to be answerable
without a network call to Stripe on every request.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import GUID
from app.utils import utcnow


class SubscriptionStatus:
    """Mirrors Stripe's subscription statuses, plus a local ``none``.

    ``TRIALING`` and ``ACTIVE`` entitle service. ``PAST_DUE`` does too, for a
    grace period — a failed card should not take a clinic's phone line down the
    same afternoon. ``CANCELED`` and ``UNPAID`` do not.
    """

    NONE = "none"
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    UNPAID = "unpaid"
    INCOMPLETE = "incomplete"

    #: Statuses under which a clinic's engine stays up.
    ENTITLED = {TRIALING, ACTIVE, PAST_DUE}


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    account_id = Column(
        GUID, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )

    stripe_customer_id = Column(String(64), nullable=True, index=True)
    stripe_subscription_id = Column(String(64), nullable=True, index=True)
    stripe_price_id = Column(String(64), nullable=True)

    plan = Column(String(40), nullable=False, default="starter")
    status = Column(String(32), nullable=False, default=SubscriptionStatus.NONE, index=True)

    #: How many clinics this plan allows. Enforced when a clinic is created,
    #: not when one is provisioned, so the limit is hit before any
    #: infrastructure is built.
    clinic_limit = Column(Integer, nullable=False, default=1)

    trial_ends_at = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)
    canceled_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account = relationship("Account", back_populates="subscription")

    @property
    def is_entitled(self) -> bool:
        """Whether this account's clinics should be serving traffic."""
        return self.status in SubscriptionStatus.ENTITLED

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Subscription {self.plan} {self.status}>"
