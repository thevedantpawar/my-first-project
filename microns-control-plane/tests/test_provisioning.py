"""Provisioning.

The two failures this suite exists to prevent are the two that actually
happened, or nearly did, on the deployment that came before it:

* a Postgres deployed without a volume, which works until the first restart and
  then loses every record;
* an engine deployed without ``ENVIRONMENT=production``, which turns the PHI
  guard into a log line, leaves ``/docs`` open, and lets a missing VAPI secret
  become an unauthenticated webhook rather than a 503.

Everything else here is in support of those.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.models.clinic import Clinic, ClinicStatus
from app.models.provisioning_event import EventOutcome, ProvisioningEvent, ProvisioningStep
from app.services.provisioning import (
    POSTGRES_DATA_PATH,
    Provisioner,
    ProvisioningError,
    resume,
    suspend,
)
from app.services.railway import RailwayError

ENGINE_CONFIG = (
    Path(__file__).resolve().parents[2]
    / "microns-ai-system"
    / "backend"
    / "app"
    / "config.py"
)


class FakeRailway:
    """Records every call in order, so the sequence can be asserted."""

    def __init__(self, *, fail_on: str | None = None):
        self.calls: list[tuple[str, dict]] = []
        self.fail_on = fail_on
        self.is_configured = True
        self.variables: dict[str, str] = {}

    def _record(self, _call: str, **kwargs):
        # The first parameter is underscore-prefixed because several of the
        # recorded calls themselves take a "name" keyword.
        self.calls.append((_call, kwargs))
        if self.fail_on == _call:
            raise RailwayError(f"simulated failure in {_call}")

    def call_names(self) -> list[str]:
        return [name for name, _ in self.calls]

    # --- the surface Provisioner uses ---
    def create_project(self, name, description=""):
        self._record("create_project", name=name)
        return {
            "id": "proj-1",
            "name": name,
            "environments": {"edges": [{"node": {"id": "env-1", "name": "production"}}]},
        }

    @staticmethod
    def production_environment_id(project):
        for edge in project["environments"]["edges"]:
            if edge["node"]["name"] == "production":
                return edge["node"]["id"]
        return None

    def create_service_from_image(self, project_id, name, image, variables=None):
        self._record("create_service_from_image", name=name, image=image, variables=variables)
        return {"id": "svc-postgres", "name": name}

    def create_volume(self, project_id, service_id, mount_path, environment_id=None):
        self._record("create_volume", service_id=service_id, mount_path=mount_path)
        return {"id": "vol-1", "name": "postgres-volume"}

    def deploy_service(self, service_id, environment_id):
        self._record("deploy_service", service_id=service_id)
        return "deployment-1"

    def create_service_from_repo(self, project_id, name, repo, branch, variables=None):
        self._record("create_service_from_repo", name=name, repo=repo, branch=branch)
        return {"id": "svc-engine", "name": name}

    def update_service_instance(self, service_id, environment_id, **fields):
        self._record("update_service_instance", service_id=service_id, fields=fields)
        return True

    def set_variables(self, project_id, environment_id, service_id, variables, skip_deploys=True):
        self._record("set_variables", service_id=service_id, variables=dict(variables))
        self.variables.update(variables)
        return True

    def list_domains(self, project_id, environment_id, service_id):
        self._record("list_domains", service_id=service_id)
        return {"serviceDomains": [], "customDomains": []}

    def create_service_domain(self, service_id, environment_id, target_port=8000):
        self._record("create_service_domain", service_id=service_id, target_port=target_port)
        return {"id": "dom-1", "domain": "glow-aesthetics-production.up.railway.app"}


@pytest.fixture()
def clinic(db, signed_up):
    from app.models.account import Account

    account = db.query(Account).one()
    row = Clinic(
        account_id=account.id,
        name="Glow Aesthetics",
        slug="glow-aesthetics",
        timezone="America/New_York",
        integrations={},
    )
    db.add(row)
    db.commit()
    return row


@pytest.fixture()
def provisioned(db, clinic):
    fake = FakeRailway()
    Provisioner(db, clinic, client=fake).provision()
    return clinic, fake


# --------------------------------------------------------------------------- #
# The volume
# --------------------------------------------------------------------------- #
def test_the_volume_is_attached_before_the_database_is_deployed(provisioned):
    """The ordering that the previous deployment got wrong.

    Postgres started without a volume writes to the container filesystem. It
    looks completely healthy — until a restart, which takes every patient
    record with it.
    """
    _, fake = provisioned
    names = fake.call_names()

    assert "create_volume" in names, "the database must be given a persistent volume"
    assert names.index("create_volume") < names.index("deploy_service"), (
        "the volume must exist before the database ever starts; attaching it "
        "afterwards means Postgres has already initialised onto ephemeral disk"
    )


def test_the_volume_is_mounted_where_postgres_actually_writes(provisioned):
    """Mounted anywhere else, the database still writes to ephemeral disk."""
    _, fake = provisioned
    call = next(kwargs for name, kwargs in fake.calls if name == "create_volume")
    assert call["mount_path"] == POSTGRES_DATA_PATH == "/var/lib/postgresql/data"


def test_the_volume_is_attached_to_the_database_not_the_engine(provisioned):
    clinic, fake = provisioned
    call = next(kwargs for name, kwargs in fake.calls if name == "create_volume")
    assert call["service_id"] == clinic.railway_postgres_service_id


def test_pgdata_points_at_the_mount_path(provisioned):
    """PGDATA and the mount path must agree, or the volume holds nothing."""
    _, fake = provisioned
    call = next(kwargs for name, kwargs in fake.calls if name == "create_service_from_image")
    assert call["variables"]["PGDATA"] == POSTGRES_DATA_PATH


# --------------------------------------------------------------------------- #
# Production posture
# --------------------------------------------------------------------------- #
def test_the_engine_is_configured_for_production(provisioned):
    """ENVIRONMENT=production is what makes the engine's guards real.

    In the engine that single value decides whether assert_production_ready
    refuses to boot on a missing key, whether the PHI check in llm.py raises or
    merely logs, whether an unset VAPI secret is a 503 or an open webhook, and
    whether /docs is served.
    """
    _, fake = provisioned
    assert fake.variables["ENVIRONMENT"] == "production"
    assert fake.variables["DEMO_MODE"] == "false"
    assert fake.variables["DEMO_SEED_ON_BOOT"] == "false"


def test_every_secret_the_engine_requires_is_set(provisioned):
    """The engine refuses to boot in production without these three."""
    _, fake = provisioned
    for name in ("ENCRYPTION_KEY", "FINGERPRINT_SECRET", "INTERNAL_API_TOKEN"):
        assert fake.variables.get(name), f"{name} must be set or the engine will not start"
        assert not fake.variables[name].startswith("change-me")


def test_the_staff_token_is_set_so_the_console_is_not_open(provisioned):
    """An unset STAFF_API_TOKEN outside production leaves the console open."""
    _, fake = provisioned
    assert fake.variables.get("STAFF_API_TOKEN")


def test_allowed_hosts_names_the_real_domain(provisioned):
    """'*' in production means the engine skips host checking entirely."""
    _, fake = provisioned
    assert fake.variables["ALLOWED_HOSTS"] != "*"
    assert "railway.app" in fake.variables["ALLOWED_HOSTS"]


def test_the_llm_defaults_to_the_rule_engine(provisioned):
    """No clinic should send prompts to an uncovered endpoint on day one.

    Neither vendor is BAA-covered until the operator arranges it, so the
    default is the engine's deterministic path.
    """
    _, fake = provisioned
    assert fake.variables["LLM_PROVIDER"] == "none"


def test_variable_names_match_the_engine_settings(provisioned):
    """Cross-check against the engine's real config, not against memory.

    A typo here is a clinic booting with a default secret while the console
    reports everything configured — the variable is simply ignored. So the
    names are checked against the fields the engine actually declares.
    """
    _, fake = provisioned
    source = ENGINE_CONFIG.read_text()

    # Field declarations in the engine's Settings model, e.g. "encryption_key:".
    declared = set(re.findall(r"^\s{4}([a-z_][a-z0-9_]*)\s*:", source, re.MULTILINE))

    # Variables the provisioner sets that are references or platform-provided
    # rather than engine settings.
    exempt = {"PUBLIC_BASE_URL"}

    unknown = {
        name
        for name in fake.variables
        if name not in exempt and name.lower() not in declared
    }
    assert not unknown, (
        "these variables do not correspond to any field in the engine's "
        f"Settings model and would be silently ignored: {sorted(unknown)}"
    )


def test_the_database_url_is_a_reference_not_a_literal(provisioned):
    """A copied DSN goes stale the moment the Postgres password rotates."""
    _, fake = provisioned
    assert fake.variables["DATABASE_URL"] == "${{Postgres.DATABASE_URL}}"


def test_the_engine_runs_a_single_replica(provisioned):
    """The engine holds an in-process limiter; a second replica doubles it."""
    _, fake = provisioned
    updates = [kwargs for name, kwargs in fake.calls if name == "update_service_instance"]
    assert any(u["fields"].get("numReplicas") == 1 for u in updates)


def test_the_healthcheck_is_configured(provisioned):
    _, fake = provisioned
    updates = [kwargs for name, kwargs in fake.calls if name == "update_service_instance"]
    assert any(u["fields"].get("healthcheckPath") == "/health" for u in updates)


# --------------------------------------------------------------------------- #
# Outcome and bookkeeping
# --------------------------------------------------------------------------- #
def test_a_provisioned_clinic_is_active_with_a_url(provisioned):
    clinic, _ = provisioned
    assert clinic.status == ClinicStatus.ACTIVE
    assert clinic.engine_url.startswith("https://")
    assert clinic.console_url.endswith("/console")
    assert clinic.provisioned_at is not None


def test_secrets_are_persisted_and_readable(provisioned, db):
    clinic, fake = provisioned
    db.expire_all()
    stored = db.query(Clinic).one()
    # What was sealed into our database is what was sent to the clinic.
    assert stored.encryption_key == fake.variables["ENCRYPTION_KEY"]
    assert stored.staff_api_token == fake.variables["STAFF_API_TOKEN"]


def test_every_step_is_recorded_in_order(provisioned, db):
    clinic, _ = provisioned
    events = (
        db.query(ProvisioningEvent)
        .filter(ProvisioningEvent.clinic_id == clinic.id)
        .order_by(ProvisioningEvent.created_at)
        .all()
    )
    succeeded = [e.step for e in events if e.outcome == EventOutcome.SUCCEEDED]
    for step in ProvisioningStep.ORDER:
        assert step in succeeded, f"{step} was never recorded as succeeding"

    sequences = [e.sequence for e in events if e.outcome == EventOutcome.SUCCEEDED]
    assert sequences == sorted(sequences), "steps must be recorded in order"


def test_no_secret_reaches_a_provisioning_event(provisioned, db):
    """The event log is read by staff and shipped to logs. It holds no keys."""
    clinic, fake = provisioned
    secret = fake.variables["ENCRYPTION_KEY"]
    events = db.query(ProvisioningEvent).filter(ProvisioningEvent.clinic_id == clinic.id).all()

    for event in events:
        blob = f"{event.message or ''} {event.details}"
        assert secret not in blob
        assert fake.variables["STAFF_API_TOKEN"] not in blob


def test_the_step_order_puts_the_volume_before_the_database_deploy():
    """Guards the constant itself, not just one run through it."""
    order = ProvisioningStep.ORDER
    assert order.index(ProvisioningStep.ATTACH_VOLUME) < order.index(
        ProvisioningStep.DEPLOY_DATABASE
    )
    assert order.index(ProvisioningStep.SET_VARIABLES) < order.index(
        ProvisioningStep.DEPLOY_SERVICE
    ), "the engine must be configured before it is started, or it boots misconfigured"
    assert order.index(ProvisioningStep.ASSIGN_DOMAIN) < order.index(
        ProvisioningStep.DEPLOY_SERVICE
    ), "ALLOWED_HOSTS cannot name a domain that has not been issued yet"


# --------------------------------------------------------------------------- #
# Failure
# --------------------------------------------------------------------------- #
def test_a_failure_marks_the_clinic_and_says_why(db, clinic):
    fake = FakeRailway(fail_on="create_volume")
    with pytest.raises(ProvisioningError):
        Provisioner(db, clinic, client=fake).provision()

    db.expire_all()
    stored = db.query(Clinic).one()
    assert stored.status == ClinicStatus.FAILED
    assert "volume" in (stored.status_detail or "").lower()


def test_a_failure_leaves_a_readable_trail(db, clinic):
    fake = FakeRailway(fail_on="create_volume")
    with pytest.raises(ProvisioningError):
        Provisioner(db, clinic, client=fake).provision()

    events = db.query(ProvisioningEvent).filter(ProvisioningEvent.clinic_id == clinic.id).all()
    failed = [e for e in events if e.outcome == EventOutcome.FAILED]
    assert len(failed) == 1
    assert failed[0].step == ProvisioningStep.ATTACH_VOLUME
    # And the steps before it are recorded as having succeeded, so a retry
    # knows what already exists.
    succeeded = {e.step for e in events if e.outcome == EventOutcome.SUCCEEDED}
    assert ProvisioningStep.CREATE_PROJECT in succeeded


def test_a_retry_reuses_resources_rather_than_duplicating_them(db, clinic):
    """Resuming after a failure must not build a second project.

    And above all it must not mint a second encryption key: a new key against
    an existing database makes every row already written unreadable.
    """
    failing = FakeRailway(fail_on="create_service_from_repo")
    with pytest.raises(ProvisioningError):
        Provisioner(db, clinic, client=failing).provision()

    db.expire_all()
    stored = db.query(Clinic).one()
    key_after_failure = stored.encryption_key
    project_after_failure = stored.railway_project_id
    assert key_after_failure is not None

    retry = FakeRailway()
    Provisioner(db, stored, client=retry).provision()

    db.expire_all()
    final = db.query(Clinic).one()
    assert final.status == ClinicStatus.ACTIVE
    assert final.encryption_key == key_after_failure, (
        "a retry must not mint a new encryption key — the existing database "
        "would become unreadable"
    )
    assert final.railway_project_id == project_after_failure
    assert "create_project" not in retry.call_names(), "the project already existed"
    assert "create_volume" not in retry.call_names(), "the volume already existed"


def test_provisioning_without_railway_configured_is_refused(db, clinic):
    class Unconfigured(FakeRailway):
        def __init__(self):
            super().__init__()
            self.is_configured = False

    with pytest.raises(ProvisioningError, match="not configured"):
        Provisioner(db, clinic, client=Unconfigured()).provision()


# --------------------------------------------------------------------------- #
# Suspend and resume
# --------------------------------------------------------------------------- #
def test_suspend_scales_to_zero_and_keeps_the_data(db, provisioned):
    clinic, _ = provisioned
    fake = FakeRailway()
    suspend(db, clinic, reason="Payment failed", client=fake)

    assert clinic.status == ClinicStatus.SUSPENDED
    assert clinic.status_detail == "Payment failed"
    update = next(kwargs for name, kwargs in fake.calls if name == "update_service_instance")
    assert update["fields"]["numReplicas"] == 0

    # Nothing was deleted — a lapsed card must not cost a clinic its records.
    assert "delete_service" not in fake.call_names()
    assert clinic.railway_volume_id is not None
    assert clinic.encryption_key is not None


def test_resume_brings_it_back(db, provisioned):
    clinic, _ = provisioned
    suspend(db, clinic, reason="Payment failed", client=FakeRailway())

    fake = FakeRailway()
    resume(db, clinic, client=fake)

    assert clinic.status == ClinicStatus.ACTIVE
    assert clinic.status_detail is None
    update = next(kwargs for name, kwargs in fake.calls if name == "update_service_instance")
    assert update["fields"]["numReplicas"] == 1
    assert "deploy_service" in fake.call_names()
