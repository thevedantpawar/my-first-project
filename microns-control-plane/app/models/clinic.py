"""A clinic: one med spa, and the engine deployment that serves it.

Tenancy is one deployment per clinic — its own service, its own database, its
own encryption key. Nothing is shared, so no query in the engine has to
remember a ``WHERE tenant_id = ...`` and no bug in it can return one clinic's
patients to another. The isolation is infrastructural rather than conditional.

This row is the control plane's record of that deployment: where it is, what
state it is in, and the secrets needed to rebuild it.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import deferred, relationship

from app.database import Base
from app.models import GUID, JSONColumn, SealedString
from app.utils import utcnow


class ClinicStatus:
    """Lifecycle of a clinic's engine.

    ``PENDING`` → ``PROVISIONING`` → ``ACTIVE`` is the happy path.
    ``SUSPENDED`` is a billing state and is reversible without losing data.
    ``FAILED`` keeps the row so the provisioning log can be read; retrying
    moves it back to ``PROVISIONING``.
    """

    PENDING = "pending"
    PROVISIONING = "provisioning"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    FAILED = "failed"
    DEPROVISIONING = "deprovisioning"
    ARCHIVED = "archived"

    ALL = {PENDING, PROVISIONING, ACTIVE, SUSPENDED, FAILED, DEPROVISIONING, ARCHIVED}
    #: States in which the clinic's engine is expected to be serving traffic.
    LIVE = {ACTIVE}


class Clinic(Base):
    __tablename__ = "clinics"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    account_id = Column(GUID, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(200), nullable=False)
    #: Becomes part of the Railway project and service name, so it is
    #: DNS-safe and unique across the system.
    slug = Column(String(60), nullable=False, unique=True, index=True)

    status = Column(String(32), nullable=False, default=ClinicStatus.PENDING, index=True)
    #: Why the clinic is in its current status, when that needs saying —
    #: the provisioning error, or "payment failed". Never holds a secret.
    status_detail = Column(String(500), nullable=True)

    # --- Clinic profile, pushed into the engine's environment --------------
    timezone = Column(String(64), nullable=False, default="America/New_York")
    contact_email = Column(String(320), nullable=True)
    phone = Column(String(40), nullable=True)
    booking_url = Column(String(500), nullable=True)
    review_url = Column(String(500), nullable=True)
    open_hour = Column(Integer, nullable=False, default=9)
    close_hour = Column(Integer, nullable=False, default=18)

    # --- Where the deployment lives ---------------------------------------
    railway_project_id = Column(String(64), nullable=True)
    railway_environment_id = Column(String(64), nullable=True)
    railway_service_id = Column(String(64), nullable=True)
    railway_postgres_service_id = Column(String(64), nullable=True)
    railway_volume_id = Column(String(64), nullable=True)
    engine_url = Column(String(500), nullable=True)

    # --- Sealed secrets ----------------------------------------------------
    #
    # Encrypted at rest under the control plane's master key. encryption_key in
    # particular decrypts this clinic's PHI; see services/crypto.py for why a
    # copy is held here rather than existing only as a Railway variable.
    #
    # Deferred, so loading a clinic does not decrypt them. Two reasons, and the
    # second is the important one:
    #
    # * Almost nothing needs them. The list and detail views, the billing
    #   reconciler and the audit trail all load clinics and touch none of
    #   these; decrypting five columns per row on every request is work done
    #   for nobody.
    # * Unsealing raises when the master key is wrong, and an eager column
    #   turns that into a failure of whatever query happened to load the row —
    #   including sign-in, which reaches clinics through the account
    #   relationship. A key-rotation mistake would lock everyone out of the
    #   console they would use to fix it. Deferred, the failure stays where it
    #   belongs: on the one endpoint that asks for a key.
    encryption_key = deferred(Column(SealedString, nullable=True))
    fingerprint_secret = deferred(Column(SealedString, nullable=True))
    internal_api_token = deferred(Column(SealedString, nullable=True))
    staff_api_token = deferred(Column(SealedString, nullable=True))
    vapi_webhook_secret = deferred(Column(SealedString, nullable=True))

    #: Non-secret integration state — which providers the clinic has connected,
    #: for display. Never holds a credential.
    integrations = Column(JSONColumn, nullable=False, default=dict)

    #: Set once the operator confirms the escrowed encryption key has been
    #: backed up outside this system. Surfaced in the UI until it is true.
    key_backup_confirmed = Column(Boolean, default=False, nullable=False)

    provisioned_at = Column(DateTime, nullable=True)
    suspended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account = relationship("Account", back_populates="clinics")
    provisioning_events = relationship(
        "ProvisioningEvent",
        back_populates="clinic",
        cascade="all, delete-orphan",
        order_by="ProvisioningEvent.created_at",
        lazy="selectin",
    )

    __table_args__ = (Index("ix_clinics_account_status", "account_id", "status"),)

    @property
    def is_live(self) -> bool:
        return self.status in ClinicStatus.LIVE

    @property
    def console_url(self) -> str | None:
        """Where this clinic's staff sign in to their own console."""
        return f"{self.engine_url.rstrip('/')}/console" if self.engine_url else None

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Clinic {self.slug} {self.status}>"
