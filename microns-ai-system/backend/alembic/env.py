"""Alembic environment.

Two things here differ from the generated template, both deliberate:

1. The URL comes from ``app.config.settings``, not from ``alembic.ini``. A
   deployment sets ``DATABASE_URL`` and nothing else; there is no second place
   for the connection string to be wrong. A caller that has already set
   ``sqlalchemy.url`` on the Config wins, so migrations can be driven against
   an arbitrary database without reconfiguring the process.
2. ``render_as_batch`` is on so the test suite's SQLite database can take the
   same migrations PostgreSQL does. SQLite cannot ALTER a column in place, and
   batch mode rewrites the table instead.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.database import Base

# Imported for the side effect of registering every table on Base.metadata.
from app import models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ``settings`` is a cached singleton read once at import, so it cannot see a
# database chosen after the fact. An explicit URL on the Config therefore takes
# precedence — that is how the test suite and the provisioner target a specific
# database.
if not config.get_main_option("sqlalchemy.url", None):
    config.set_main_option("sqlalchemy.url", settings.sqlalchemy_url)

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to):
    """Keep Alembic's hands off tables this app does not own.

    Nothing else writes to this database today, but a clinic's DBA adding a
    reporting view should not have it dropped by the next autogenerate.
    """
    if type_ == "table" and name == "alembic_version":
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=_include_object,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=_include_object,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
