"""Database engine, session factory and schema bootstrap."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Generator

from sqlalchemy import create_engine, text
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

if TYPE_CHECKING:  # pragma: no cover - typing only
    from alembic.config import Config

logger = logging.getLogger(__name__)

_connect_args = {}
if settings.is_sqlite:
    # Only used by the test suite; PostgreSQL is the supported production target.
    _connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.sqlalchemy_url,
    echo=settings.db_echo,
    pool_pre_ping=True,
    future=True,
    connect_args=_connect_args,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base for every model in the system."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


#: The baseline revision. A database that already carries the six engine tables
#: but no ``alembic_version`` predates migrations and is stamped at this
#: revision rather than rebuilt — see ``_bootstrap_migrations``.
BASELINE_REVISION = "600c428b0614"


def _alembic_config(url: str | None = None, *, configure_logging: bool = False) -> "Config":
    """Alembic configuration pointed at this package's migration directory.

    ``url`` overrides the configured database, which is how the provisioner
    migrates a newly created clinic database and how the tests drive the chain
    against a scratch file.
    """
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", url or settings.sqlalchemy_url)
    # Off by default because the common caller is application startup, where
    # Alembic's fileConfig would disable the logging the app has already set up
    # — see the note in alembic/env.py. The CLI turns it back on.
    config.attributes["configure_logging"] = configure_logging
    return config


def _bootstrap_migrations(target_engine=None) -> None:
    """Bring the schema to head, whatever state this database starts in.

    Three cases, because a deployment that predates migrations is a real state
    this code has to survive rather than a hypothetical:

    * **Already under Alembic** — ``alembic_version`` exists. Upgrade to head.
    * **Predates Alembic** — the engine tables exist but ``alembic_version``
      does not. This is the schema the baseline describes, so it is *stamped*
      at the baseline and then upgraded. Running the baseline against it would
      fail on ``table already exists``, and dropping it to rebuild would
      destroy a clinic's records.
    * **Empty** — run every migration from the baseline forward.
    """
    from alembic import command
    from alembic.runtime.migration import MigrationContext

    target_engine = target_engine if target_engine is not None else engine

    with target_engine.connect() as connection:
        context = MigrationContext.configure(connection)
        current = context.get_current_revision()
        has_engine_tables = sa_inspect(connection).has_table("patients")

    config = _alembic_config(str(target_engine.url))

    if current is None and has_engine_tables:
        logger.info(
            "Database predates migrations — stamping it at the baseline (%s) "
            "rather than rebuilding it",
            BASELINE_REVISION,
        )
        command.stamp(config, BASELINE_REVISION)

    command.upgrade(config, "head")


def init_db() -> None:
    """Create extensions and bring the schema to head.

    PostgreSQL — every real deployment — goes through Alembic, so a schema
    change can ship to a clinic that already holds records.

    SQLite is the test suite only, and it uses ``create_all`` because running
    the migration chain for each of several hundred tests costs far more than
    it proves. What guards against the two drifting apart is
    ``test_migrations.py``, which asserts that the chain and the models produce
    the same schema.
    """
    # Imported for the side effect of registering every table on Base.metadata.
    from app import models  # noqa: F401

    if settings.is_sqlite:
        Base.metadata.create_all(bind=engine)
        logger.info("Database schema ready (%d tables, create_all)", len(Base.metadata.tables))
        return

    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))

    _bootstrap_migrations()
    logger.info("Database schema ready (%d tables, migrated to head)", len(Base.metadata.tables))
