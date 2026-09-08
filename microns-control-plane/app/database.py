"""Database engine, session factory and schema bootstrap.

Mirrors the engine's arrangement deliberately: PostgreSQL deployments go
through Alembic so a schema change can ship to a running control plane, and the
test suite uses ``create_all`` with a drift test standing guard between them.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

if TYPE_CHECKING:  # pragma: no cover - typing only
    from alembic.config import Config

logger = logging.getLogger(__name__)

_connect_args = {}
if settings.is_sqlite:
    # Only used by the test suite; PostgreSQL is the supported target.
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
    """Declarative base for every control-plane model."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _alembic_config(url: str | None = None, *, configure_logging: bool = False) -> "Config":
    """Alembic configuration pointed at this package's migration directory."""
    from alembic.config import Config

    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    config.set_main_option("sqlalchemy.url", url or settings.sqlalchemy_url)
    # Off by default because the common caller is application startup, where
    # Alembic's fileConfig would disable the logging the app has already set up
    # and drop the root level to WARNING, silencing the service for the rest of
    # the process — see the note in alembic/env.py. The CLI turns it back on.
    config.attributes["configure_logging"] = configure_logging
    return config


def init_db() -> None:
    """Bring the schema to head.

    SQLite is the test suite only and uses ``create_all``; ``test_migrations``
    asserts the chain and the models agree.
    """
    # Imported for the side effect of registering every table on Base.metadata.
    from app import models  # noqa: F401

    if settings.is_sqlite:
        Base.metadata.create_all(bind=engine)
        logger.info("Schema ready (%d tables, create_all)", len(Base.metadata.tables))
        return

    from alembic import command

    command.upgrade(_alembic_config(), "head")
    logger.info("Schema ready (%d tables, migrated to head)", len(Base.metadata.tables))
