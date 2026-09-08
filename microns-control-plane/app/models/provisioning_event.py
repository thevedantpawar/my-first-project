"""An append-only log of what provisioning did.

Provisioning a clinic is a dozen calls to someone else's API, any of which can
fail halfway. Without a record, a half-built clinic is a mystery: you cannot
tell whether the volume was attached before the deploy failed, and retrying
blindly either duplicates resources or skips a step.

Each step writes a row here as it starts and as it settles. That is what the
progress UI reads, what a retry consults to know where to resume, and what an
operator reads when a clinic is stuck.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models import GUID, JSONColumn
from app.utils import utcnow


class ProvisioningStep:
    """The ordered steps of building a clinic's engine.

    The order matters and is asserted in the tests: the volume must be attached
    before the database is first deployed, or Postgres initialises onto
    ephemeral disk and the clinic's records die at the first restart.
    """

    CREATE_PROJECT = "create_project"
    CREATE_DATABASE = "create_database"
    ATTACH_VOLUME = "attach_volume"
    DEPLOY_DATABASE = "deploy_database"
    GENERATE_SECRETS = "generate_secrets"
    CREATE_SERVICE = "create_service"
    SET_VARIABLES = "set_variables"
    DEPLOY_SERVICE = "deploy_service"
    ASSIGN_DOMAIN = "assign_domain"
    VERIFY_HEALTH = "verify_health"

    #: Executed in this order, and the order carries two load-bearing
    #: constraints that the tests assert rather than trust:
    #:
    #: * ATTACH_VOLUME before DEPLOY_DATABASE — a Postgres that has already
    #:   started without a volume is writing to ephemeral disk.
    #: * SET_VARIABLES and ASSIGN_DOMAIN before DEPLOY_SERVICE — the engine
    #:   reads its configuration at boot, and ALLOWED_HOSTS cannot name a
    #:   domain that has not been issued yet. Deploying first would mean a
    #:   clinic's first boot is a misconfigured one.
    ORDER = [
        CREATE_PROJECT,
        CREATE_DATABASE,
        ATTACH_VOLUME,
        DEPLOY_DATABASE,
        GENERATE_SECRETS,
        CREATE_SERVICE,
        SET_VARIABLES,
        ASSIGN_DOMAIN,
        DEPLOY_SERVICE,
        VERIFY_HEALTH,
    ]


class EventOutcome:
    STARTED = "started"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


class ProvisioningEvent(Base):
    __tablename__ = "provisioning_events"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    clinic_id = Column(GUID, ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)

    step = Column(String(48), nullable=False, index=True)
    outcome = Column(String(24), nullable=False, default=EventOutcome.STARTED)
    #: Position in ProvisioningStep.ORDER, so the UI can render progress
    #: without re-deriving the sequence.
    sequence = Column(Integer, nullable=False, default=0)

    #: Human-readable. Written to be shown to the clinic owner, so it says what
    #: happened rather than quoting a GraphQL error.
    message = Column(String(1000), nullable=True)
    #: Structured context: resource ids, timings, the provider's error code.
    #: Scrubbed of secrets before it is written — see provisioning.py.
    details = Column(JSONColumn, nullable=False, default=dict)

    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    clinic = relationship("Clinic", back_populates="provisioning_events")

    __table_args__ = (Index("ix_provisioning_clinic_created", "clinic_id", "created_at"),)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ProvisioningEvent {self.step} {self.outcome}>"
