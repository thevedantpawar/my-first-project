"""Database engine, session factory and schema bootstrap."""

from __future__ import annotations

import logging
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

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


def init_db() -> None:
    """Create extensions and tables.

    ``create_all`` is intentional for a single-service deployment: the schema is
    owned entirely by this app. If you add a second writer, or need
    column-level migrations, introduce Alembic and call ``upgrade head`` here
    instead.
    """
    # Imported for the side effect of registering every table on Base.metadata.
    from app import models  # noqa: F401

    if not settings.is_sqlite:
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))

    Base.metadata.create_all(bind=engine)
    logger.info("Database schema ready (%d tables)", len(Base.metadata.tables))
