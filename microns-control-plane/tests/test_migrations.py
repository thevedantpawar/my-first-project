"""The control plane's migration chain must match its models.

Same guard as the engine's, for the same reason: PostgreSQL deployments run the
Alembic chain and the test suite runs ``create_all``, so without this nothing
would notice a model changing without a migration until a deployment failed.
"""

from __future__ import annotations

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
