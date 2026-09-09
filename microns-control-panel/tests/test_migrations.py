"""The control panel's migration chain must match its models.

Same guard as the engine's, for the same reason: PostgreSQL deployments run the
Alembic chain and the test suite runs ``create_all``, so without this nothing
would notice a model changing without a migration until a deployment failed.
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
from sqlalchemy import create_engine

from app.database import Base

ROOT = Path(__file__).resolve().parents[1]


def _config(url: str) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    return config


@pytest.fixture()
def migrated_engine(tmp_path):
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    command.upgrade(_config(url), "head")
    engine = create_engine(url)
    yield engine
    engine.dispose()


def test_migration_chain_matches_the_models(migrated_engine):
    with migrated_engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={"compare_type": True, "target_metadata": Base.metadata},
        )
        diff = compare_metadata(context, Base.metadata)

    diff = [d for d in diff if "alembic_version" not in repr(d)]
    assert diff == [], (
        "The migration chain and the models disagree. Generate a migration with:\n"
        "    alembic revision --autogenerate -m '<what changed>'\n\n"
        "Differences:\n" + "\n".join(f"  - {d}" for d in diff)
    )


def test_every_migration_has_a_downgrade(migrated_engine):
    command.downgrade(_config(str(migrated_engine.url)), "base")


def test_chain_is_linear():
    """One head, so `upgrade head` is never ambiguous."""
    script = ScriptDirectory(str(ROOT / "alembic"))
    heads = script.get_heads()
    assert len(heads) == 1, f"Expected exactly one migration head, found {heads}"


def test_migrating_at_startup_does_not_silence_the_application(tmp_path):
    """Running the chain must not take the application's logging away.

    ``fileConfig`` defaults to ``disable_existing_loggers=True`` and resets the
    root level to alembic.ini's WARNING. Migrations run inside application
    startup on Railway, so calling it there disables every logger the app has
    already configured — for the rest of the process's life.

    This cost a real debugging session: the deploy log showed the boot warnings,
    then the migrations, then nothing at all, which reads exactly like a process
    that hung. The service was serving traffic the whole time.
    """
    from app.database import _alembic_config

    logging.basicConfig(level=logging.INFO, force=True)
    logger = logging.getLogger("microns.control.canary")

    command.upgrade(_alembic_config(f"sqlite:///{tmp_path / 'canary.db'}"), "head")

    assert not logger.disabled, "the application's logger was disabled by Alembic"
    assert logger.isEnabledFor(logging.INFO), (
        "the root log level was dropped to alembic.ini's WARNING, so every "
        "INFO line the application emits after its first migration is lost"
    )


def test_the_cli_still_gets_alembic_logging():
    """Suppressing it at startup must not suppress it at a terminal too."""
    from app.database import _alembic_config

    assert _alembic_config(configure_logging=True).attributes["configure_logging"] is True
    assert _alembic_config().attributes["configure_logging"] is False
