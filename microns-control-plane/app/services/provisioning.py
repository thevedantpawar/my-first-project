"""Building a clinic's engine, one recorded step at a time.

Two things this module exists to guarantee, both of them lessons from the
deployment that came before it:

**The database gets a volume before it ever starts.** ``ATTACH_VOLUME`` runs
before ``DEPLOY_DATABASE``, and the ordering is asserted in the tests rather
than left to whoever edits the list next. A Postgres that boots without one is
writing to the container filesystem: it works perfectly, right up until the
first restart takes every patient record with it.

**Every clinic runs with production guards on.** ``ENVIRONMENT=production`` is
not a default the operator can forget — it is written by the provisioner. In
the engine, that one value is what makes ``assert_production_ready`` refuse to
boot on a missing key, what turns the PHI-leak check in ``llm.py`` from a log
line into an exception, what makes an unset VAPI secret a 503 instead of an
open webhook, and what closes ``/docs``.

Each step writes a ``ProvisioningEvent`` as it starts and as it settles, so a
half-built clinic can be read rather than guessed at, and so a retry knows
where it stopped.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Dict, Optional

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models.clinic import Clinic, ClinicStatus
from app.models.provisioning_event import EventOutcome, ProvisioningEvent, ProvisioningStep
from app.services.railway import RailwayClient, RailwayError, RailwayNotConfigured
from app.services.secrets import ClinicSecrets, scrub
from app.utils import utcnow

logger = logging.getLogger(__name__)

#: Where the volume is mounted.
POSTGRES_VOLUME_MOUNT = "/var/lib/postgresql/data"

#: Where Postgres actually keeps its data — a *subdirectory* of the mount.
#:
#: These must not be the same path, and the reason is not obvious until you
#: watch it fail: Railway's volumes arrive containing a ``lost+found``
#: directory, and ``initdb`` refuses to initialise into a directory that is not
#: empty. Pointing PGDATA at the mount point itself produces a container that
#: crash-loops with "directory exists but is not empty" and never starts.
#:
#: A subdirectory under the mount is what the postgres image documents, and it
#: is still on the volume, so the data still survives a restart — which is the
#: whole point of attaching one.
POSTGRES_DATA_PATH = f"{POSTGRES_VOLUME_MOUNT}/pgdata"

#: The role and database the engine connects as.
POSTGRES_USER = "microns"
POSTGRES_DB = "microns"

#: The DSN the engine is given, defined *on the Postgres service*.
#:
#: Railway's Postgres **template** ships a ``DATABASE_URL`` variable. A service
#: created from the bare ``postgres`` image — which is what this provisioner
#: does, so that the image is pinned — ships nothing of the kind. Referencing
#: ``${{Postgres.DATABASE_URL}}`` against such a service does not fail: Railway
#: finds no variable of that name and passes the reference through *literally*,
#: so the engine hands SQLAlchemy the twenty-eight characters
#: ``${{Postgres.DATABASE_URL}}`` and dies on "Could not parse SQLAlchemy URL
#: from given URL string". Nothing in that message points at a missing
#: variable, and the database itself is healthy throughout.
#:
#: Defining it here restores the assumption the rest of the code makes. The
#: inner references are resolved by Railway on the Postgres service, so the
#: password is never copied into a second variable and rotating it does not
#: strand the engine on a stale DSN. ``RAILWAY_PRIVATE_DOMAIN`` keeps the
#: traffic on the private network.
POSTGRES_DSN = (
    "postgresql://${{POSTGRES_USER}}:${{POSTGRES_PASSWORD}}"
    "@${{RAILWAY_PRIVATE_DOMAIN}}:5432/${{POSTGRES_DB}}"
)

#: The port the engine's Dockerfile exposes.
ENGINE_PORT = 8000


class ProvisioningError(RuntimeError):
    """Provisioning failed. The message is written to the clinic for display."""


class Provisioner:
    """Runs the provisioning sequence for one clinic."""

    def __init__(
        self,
        db: Session,
        clinic: Clinic,
        client: Optional[RailwayClient] = None,
    ) -> None:
        self.db = db
        self.clinic = clinic
        self.client = client or RailwayClient()

    # ------------------------------------------------------------------ #
    # Event recording
    # ------------------------------------------------------------------ #
    def _record(
        self,
        step: str,
        outcome: str,
        *,
        message: Optional[str] = None,
        details: Optional[dict] = None,
        duration_ms: Optional[int] = None,
    ) -> ProvisioningEvent:
        event = ProvisioningEvent(
            clinic_id=self.clinic.id,
            step=step,
            outcome=outcome,
            sequence=(
                ProvisioningStep.ORDER.index(step) if step in ProvisioningStep.ORDER else 0
            ),
            message=message,
            # Scrubbed on the way in: a caller that passes a whole API response
            # must not be able to persist a token from it.
            details=scrub(details or {}),
            duration_ms=duration_ms,
        )
        self.db.add(event)
        # Committed per step rather than at the end, so a crash mid-sequence
        # still leaves a readable trail.
        self.db.commit()
        return event

    def _step(self, step: str, description: str, fn: Callable[[], Any]) -> Any:
        """Run one step, recording its start, outcome and duration."""
        self._record(step, EventOutcome.STARTED, message=description)
        started = time.perf_counter()
        try:
            result = fn()
        except (RailwayError, httpx.HTTPError) as exc:
            elapsed = int((time.perf_counter() - started) * 1000)
            message = f"{description} failed: {exc}"
            self._record(
                step,
                EventOutcome.FAILED,
                message=message,
                details={"error_type": type(exc).__name__},
                duration_ms=elapsed,
            )
            raise ProvisioningError(message) from exc

        elapsed = int((time.perf_counter() - started) * 1000)
        self._record(step, EventOutcome.SUCCEEDED, message=description, duration_ms=elapsed)
        return result

    # ------------------------------------------------------------------ #
    # Environment for a clinic's engine
    # ------------------------------------------------------------------ #
    def engine_environment(self, secrets: ClinicSecrets) -> Dict[str, str]:
        """Every variable a clinic's engine boots with.

        ``ENVIRONMENT=production`` and ``DEMO_MODE=false`` are set here rather
        than left to a default, because in the engine those two decide whether
        the safety checks are real. ``ALLOWED_HOSTS`` is set for the same
        reason — in production the engine only applies host checking when it is
        not the wildcard.
        """
        clinic = self.clinic
        env: Dict[str, str] = {
            # --- Posture. Not optional, not defaulted. ---
            "ENVIRONMENT": "production",
            "DEMO_MODE": "false",
            "DEMO_SEED_ON_BOOT": "false",
            "LOG_LEVEL": "INFO",
            # --- Database. A reference, so rotating the Postgres password
            #     does not silently strand the engine on a stale DSN. ---
            "DATABASE_URL": "${{Postgres.DATABASE_URL}}",
            # --- Per-clinic secrets ---
            **secrets.as_env(),
            # --- Clinic profile ---
            "CLINIC_NAME": clinic.name,
            "CLINIC_TIMEZONE": clinic.timezone,
            "CLINIC_OPEN_HOUR": str(clinic.open_hour),
            "CLINIC_CLOSE_HOUR": str(clinic.close_hour),
            # --- Language model. Defaults to the deterministic rule engine:
            #     neither vendor is BAA-covered until the operator arranges it,
            #     and a clinic should not start sending prompts to an
            #     uncovered endpoint on its first day. ---
            "LLM_PROVIDER": settings.default_llm_provider,
        }

        if clinic.phone:
            env["CLINIC_PHONE"] = clinic.phone
        if clinic.booking_url:
            env["CLINIC_BOOKING_URL"] = clinic.booking_url
        if clinic.review_url:
            env["CLINIC_REVIEW_URL"] = clinic.review_url

        if settings.default_llm_provider == "openai" and settings.default_openai_api_key:
            env["OPENAI_API_KEY"] = settings.default_openai_api_key
        if settings.default_llm_provider == "gemini" and settings.default_gemini_api_key:
            env["GEMINI_API_KEY"] = settings.default_gemini_api_key

        return env

    # ------------------------------------------------------------------ #
    # The sequence
    # ------------------------------------------------------------------ #
    def provision(self) -> Clinic:
        """Build the clinic's engine.

        Raises ``ProvisioningError`` on failure, having marked the clinic
        FAILED with a readable reason. The partially built project is left in
        place on purpose: tearing it down would destroy the evidence, and a
        retry can reuse what already exists.
        """
        clinic = self.clinic

        if not self.client.is_configured:
            raise ProvisioningError(
                "Railway is not configured on this control plane. Set "
                "RAILWAY_API_TOKEN and RAILWAY_WORKSPACE_ID."
            )

        clinic.status = ClinicStatus.PROVISIONING
        clinic.status_detail = None
        self.db.commit()

        try:
            self._run_sequence()
        except ProvisioningError as exc:
            clinic.status = ClinicStatus.FAILED
            clinic.status_detail = str(exc)[:500]
            self.db.commit()
            raise

        clinic.status = ClinicStatus.ACTIVE
        clinic.status_detail = None
        clinic.provisioned_at = utcnow()
        self.db.commit()
        logger.info("Clinic %s provisioned at %s", clinic.slug, clinic.engine_url)
        return clinic

    def _run_sequence(self) -> None:
        clinic = self.clinic
        client = self.client

        # 1. Project ------------------------------------------------------
        def _create_project():
            project = client.create_project(
                f"microns-{clinic.slug}",
                description=f"Microns revenue engine for {clinic.name}",
            )
            clinic.railway_project_id = project["id"]
            clinic.railway_environment_id = client.production_environment_id(project)
            if not clinic.railway_environment_id:
                raise ProvisioningError("Railway created a project with no environment.")
            self.db.commit()
            return project

        if not clinic.railway_project_id:
            self._step(ProvisioningStep.CREATE_PROJECT, "Creating the clinic's project", _create_project)

        # 2. Postgres service --------------------------------------------
        def _create_database():
            service = client.create_service_from_image(
                clinic.railway_project_id,
                "Postgres",
                settings.clinic_postgres_image,
                variables={
                    "POSTGRES_USER": POSTGRES_USER,
                    "POSTGRES_DB": POSTGRES_DB,
                    # Generated per clinic and never reused. URL-safe by
                    # construction, so it needs no escaping in the DSN below.
                    "POSTGRES_PASSWORD": ClinicSecrets().internal_api_token,
                    # The bare postgres image publishes no DATABASE_URL of its
                    # own — see POSTGRES_DSN for what breaks without this.
                    "DATABASE_URL": POSTGRES_DSN,
                    # A subdirectory of the mount, not the mount itself — see
                    # POSTGRES_DATA_PATH.
                    "PGDATA": POSTGRES_DATA_PATH,
                },
            )
            clinic.railway_postgres_service_id = service["id"]
            self.db.commit()
            return service

        if not clinic.railway_postgres_service_id:
            self._step(ProvisioningStep.CREATE_DATABASE, "Creating the database", _create_database)

        # 3. Volume — BEFORE the database is deployed ---------------------
        #
        # This is the step whose absence cost the previous deployment every
        # record it held. Postgres without a volume starts happily and writes
        # to the container filesystem; nothing looks wrong until a restart.
        def _attach_volume():
            volume = client.create_volume(
                clinic.railway_project_id,
                clinic.railway_postgres_service_id,
                POSTGRES_VOLUME_MOUNT,
                environment_id=clinic.railway_environment_id,
            )
            clinic.railway_volume_id = volume["id"]
            self.db.commit()
            return volume

        if not clinic.railway_volume_id:
            self._step(
                ProvisioningStep.ATTACH_VOLUME,
                "Attaching a persistent volume to the database",
                _attach_volume,
            )

        # 4. Deploy the database ------------------------------------------
        self._step(
            ProvisioningStep.DEPLOY_DATABASE,
            "Starting the database",
            lambda: client.deploy_service(
                clinic.railway_postgres_service_id, clinic.railway_environment_id
            ),
        )

        # 5. Secrets -------------------------------------------------------
        #
        # Generated once and sealed immediately. If provisioning fails after
        # this point, a retry reuses them rather than minting a second set —
        # a new encryption key against an existing database would make every
        # row already written unreadable.
        def _generate_secrets():
            if clinic.encryption_key:
                return {"reused": True}
            secrets = ClinicSecrets()
            clinic.encryption_key = secrets.encryption_key
            clinic.fingerprint_secret = secrets.fingerprint_secret
            clinic.internal_api_token = secrets.internal_api_token
            clinic.staff_api_token = secrets.staff_api_token
            clinic.vapi_webhook_secret = secrets.vapi_webhook_secret
            self.db.commit()
            return {"reused": False}

        self._step(
            ProvisioningStep.GENERATE_SECRETS,
            "Generating this clinic's encryption key and access tokens",
            _generate_secrets,
        )

        # 6. Engine service ------------------------------------------------
        def _create_service():
            service = client.create_service_from_repo(
                clinic.railway_project_id,
                "Engine",
                settings.engine_repo,
                settings.engine_branch,
            )
            clinic.railway_service_id = service["id"]
            self.db.commit()

            client.update_service_instance(
                service["id"],
                clinic.railway_environment_id,
                rootDirectory=settings.engine_root_directory,
                healthcheckPath="/health",
                restartPolicyType="ON_FAILURE",
                # The engine holds an in-process rate limiter and an in-process
                # scheduler; a second replica would double both. Scaling is a
                # deliberate change, not a default.
                numReplicas=1,
            )
            return service

        if not clinic.railway_service_id:
            self._step(
                ProvisioningStep.CREATE_SERVICE, "Creating the engine service", _create_service
            )

        # 7. Variables ------------------------------------------------------
        def _set_variables():
            secrets = ClinicSecrets(
                encryption_key=clinic.encryption_key,
                fingerprint_secret=clinic.fingerprint_secret,
                internal_api_token=clinic.internal_api_token,
                staff_api_token=clinic.staff_api_token,
                vapi_webhook_secret=clinic.vapi_webhook_secret,
            )
            return client.set_variables(
                clinic.railway_project_id,
                clinic.railway_environment_id,
                clinic.railway_service_id,
                self.engine_environment(secrets),
                skip_deploys=True,
            )

        self._step(
            ProvisioningStep.SET_VARIABLES,
            "Configuring the engine with production safety settings",
            _set_variables,
        )

        # 8. Domain, then deploy -------------------------------------------
        #
        # The domain is assigned before the deploy so ALLOWED_HOSTS can name it
        # on the very first boot rather than needing a second deploy to become
        # correct.
        def _assign_domain():
            existing = client.list_domains(
                clinic.railway_project_id,
                clinic.railway_environment_id,
                clinic.railway_service_id,
            )
            domains = existing.get("serviceDomains") or []
            record = domains[0] if domains else client.create_service_domain(
                clinic.railway_service_id,
                clinic.railway_environment_id,
                target_port=ENGINE_PORT,
            )
            host = record["domain"]
            clinic.engine_url = f"https://{host}"
            self.db.commit()

            client.set_variables(
                clinic.railway_project_id,
                clinic.railway_environment_id,
                clinic.railway_service_id,
                {
                    "ALLOWED_HOSTS": host,
                    "CORS_ORIGINS": f"https://{host}",
                    "PUBLIC_BASE_URL": clinic.engine_url,
                },
                skip_deploys=True,
            )
            return {"domain": host}

        self._step(ProvisioningStep.ASSIGN_DOMAIN, "Assigning a web address", _assign_domain)

        self._step(
            ProvisioningStep.DEPLOY_SERVICE,
            "Deploying the engine",
            lambda: client.deploy_service(
                clinic.railway_service_id, clinic.railway_environment_id
            ),
        )

        # 9. Health --------------------------------------------------------
        #
        # Recorded, never fatal. A deploy that is still building is the normal
        # case at this point, and failing the whole provision because the first
        # poll came back too early would be wrong.
        self._step(
            ProvisioningStep.VERIFY_HEALTH,
            "Checking the engine is responding",
            self._verify_health,
        )

    def _verify_health(self) -> Dict[str, Any]:
        """Poll the new engine's /health once, and report what it said."""
        if not self.clinic.engine_url:
            return {"checked": False, "reason": "no domain assigned"}
        try:
            response = httpx.get(f"{self.clinic.engine_url}/health", timeout=10.0)
            body = response.json() if response.status_code == 200 else {}
            return {
                "checked": True,
                "status_code": response.status_code,
                "engine_status": body.get("status"),
                # The engine's own startup warnings, surfaced to the operator.
                "engine_warnings": body.get("warnings", []),
            }
        except httpx.HTTPError as exc:
            # Still building is the normal case here.
            return {"checked": False, "reason": type(exc).__name__}


# --------------------------------------------------------------------------- #
# Lifecycle beyond the initial build
# --------------------------------------------------------------------------- #
def suspend(db: Session, clinic: Clinic, *, reason: str, client: Optional[RailwayClient] = None) -> Clinic:
    """Take a clinic's engine offline without destroying anything.

    Scaling to zero rather than deleting: the database, its volume and every
    record stay exactly where they are, so resuming is one call and a lapsed
    card never costs a clinic its patient history.
    """
    client = client or RailwayClient()
    if clinic.railway_service_id and clinic.railway_environment_id and client.is_configured:
        try:
            client.update_service_instance(
                clinic.railway_service_id, clinic.railway_environment_id, numReplicas=0
            )
        except RailwayError as exc:
            logger.warning("Could not scale down %s: %s", clinic.slug, exc)

    clinic.status = ClinicStatus.SUSPENDED
    clinic.status_detail = reason[:500]
    clinic.suspended_at = utcnow()
    db.commit()
    return clinic


def resume(db: Session, clinic: Clinic, *, client: Optional[RailwayClient] = None) -> Clinic:
    """Bring a suspended clinic's engine back."""
    client = client or RailwayClient()
    if clinic.railway_service_id and clinic.railway_environment_id and client.is_configured:
        client.update_service_instance(
            clinic.railway_service_id, clinic.railway_environment_id, numReplicas=1
        )
        client.deploy_service(clinic.railway_service_id, clinic.railway_environment_id)

    clinic.status = ClinicStatus.ACTIVE
    clinic.status_detail = None
    clinic.suspended_at = None
    db.commit()
    return clinic


__all__ = [
    "Provisioner",
    "ProvisioningError",
    "POSTGRES_VOLUME_MOUNT",
    "POSTGRES_DSN",
    "POSTGRES_DATA_PATH",
    "ENGINE_PORT",
    "suspend",
    "resume",
]
