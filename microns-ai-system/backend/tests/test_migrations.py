"""The migration chain and the models must describe the same schema.

``init_db`` takes two different routes: PostgreSQL deployments run the Alembic
chain, and the test suite runs ``create_all``. That is a deliberate trade — the
chain is what a clinic's live database needs, ``create_all`` is what several
hundred tests can afford — but it means nothing would notice if someone added a
column to a model and forgot the migration. The clinic would find out at boot.

These tests are what notices.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy import inspect as sa_inspect

from app.database import BASELINE_REVISION, Base

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _config(url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    return config


@pytest.fixture()
def migrated_engine(tmp_path):
    """A database built by running the migration chain from empty to head."""
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    # _config sets sqlalchemy.url explicitly, which env.py honours over the
    # cached application settings — so this runs against tmp_path, not the
    # suite's shared database.
    command.upgrade(_config(url), "head")

    engine = create_engine(url)
    yield engine
    engine.dispose()


def test_migration_chain_matches_the_models(migrated_engine):
    """Upgrading from empty must produce exactly what the models declare.

    A non-empty diff means a model changed without a migration. The failure
    message names each difference.
    """
    with migrated_engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={"compare_type": True, "target_metadata": Base.metadata},
        )
        diff = compare_metadata(context, Base.metadata)

    # alembic_version is Alembic's own bookkeeping and is not in our metadata.
    diff = [d for d in diff if "alembic_version" not in repr(d)]

    assert diff == [], (
        "The migration chain and the models disagree. Generate a migration with:\n"
        "    alembic revision --autogenerate -m '<what changed>'\n\n"
        "Differences:\n" + "\n".join(f"  - {d}" for d in diff)
    )


def test_every_migration_has_a_downgrade(migrated_engine):
    """Downgrading to base must not raise.

    A migration that cannot be reversed is one a clinic cannot be rolled back
    from at three in the morning.
    """
    command.downgrade(_config(str(migrated_engine.url)), "base")


def test_chain_is_linear():
    """One head, so `upgrade head` is never ambiguous.

    Two heads means two people generated a migration from the same parent, and
    whichever deploys second silently skips the other's.
    """
    script = ScriptDirectory(str(BACKEND_DIR / "alembic"))
    heads = script.get_heads()
    assert len(heads) == 1, f"Expected exactly one migration head, found {heads}"


def test_baseline_revision_constant_is_real():
    """``database.BASELINE_REVISION`` must name a revision that exists.

    It is used to stamp deployments that predate migrations. If it names a
    revision Alembic cannot find, that stamp raises and the engine will not
    boot against an existing clinic database.
    """
    script = ScriptDirectory(str(BACKEND_DIR / "alembic"))
    assert script.get_revision(BASELINE_REVISION) is not None


# --------------------------------------------------------------------------- #
# Bootstrapping an existing deployment
#
# The engine has been running in production since before migrations existed,
# so its database holds the six tables and no ``alembic_version``. Getting that
# case wrong either refuses to boot ("table already exists") or, far worse,
# rebuilds a clinic's database. These cover all three states.
# --------------------------------------------------------------------------- #


def test_bootstrap_stamps_a_database_that_predates_migrations(tmp_path):
    """An existing schema is stamped, not rebuilt — and keeps its rows."""
    from app.database import _bootstrap_migrations

    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    legacy = create_engine(url)

    # Recreate the pre-migration world: create_all, no alembic_version.
    Base.metadata.create_all(bind=legacy)
    with legacy.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO patients (id, encrypted_phone, phone_fingerprint, "
                "sms_consent, marketing_consent, created_at, updated_at) "
                "VALUES ('11111111-1111-1111-1111-111111111111', 'x', 'fp-1', "
                "0, 0, '2026-01-01', '2026-01-01')"
            )
        )

    _bootstrap_migrations(target_engine=legacy)

    with legacy.connect() as connection:
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
        survivors = connection.execute(text("SELECT count(*) FROM patients")).scalar()

    script = ScriptDirectory(str(BACKEND_DIR / "alembic"))
    assert version == script.get_current_head(), "should be brought all the way to head"
    assert survivors == 1, "the existing row must survive — this is a clinic's data"
    legacy.dispose()


def test_bootstrap_migrates_an_empty_database(tmp_path):
    """A brand-new clinic database runs the chain from the baseline forward."""
    from app.database import _bootstrap_migrations

    fresh = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    _bootstrap_migrations(target_engine=fresh)

    with fresh.connect() as connection:
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
        assert sa_inspect(connection).has_table("patients")

    script = ScriptDirectory(str(BACKEND_DIR / "alembic"))
    assert version == script.get_current_head()
    fresh.dispose()


def test_bootstrap_is_idempotent(tmp_path):
    """Booting twice is the normal case — a restart must not raise."""
    from app.database import _bootstrap_migrations

    db = create_engine(f"sqlite:///{tmp_path / 'twice.db'}")
    _bootstrap_migrations(target_engine=db)
    _bootstrap_migrations(target_engine=db)  # must not raise
    db.dispose()


def test_migrating_at_startup_does_not_silence_the_engine(tmp_path):
    """Running the chain must not take the engine's logging away.

    ``fileConfig`` defaults to ``disable_existing_loggers=True`` and resets the
    root level to alembic.ini's WARNING. The engine migrates inside application
    startup on Railway, so calling it there disables every logger already
    configured — for the rest of the process's life.

    That matters more here than in the control panel: this is the service
    handling patient records, and a clinic whose engine stops logging after its
    first boot is one nobody can operate. The symptom is not an error either —
    the deploy log shows the boot lines, the migrations, and then silence, which
    reads exactly like a hung process.
    """
    from app.database import _alembic_config

    logging.basicConfig(level=logging.INFO, force=True)
    logger = logging.getLogger("microns.canary")

    command.upgrade(_alembic_config(f"sqlite:///{tmp_path / 'canary.db'}"), "head")

    assert not logger.disabled, "the engine's logger was disabled by Alembic"
    assert logger.isEnabledFor(logging.INFO), (
        "the root log level was dropped to alembic.ini's WARNING, so every "
        "INFO line the engine emits after its first migration is lost"
    )
