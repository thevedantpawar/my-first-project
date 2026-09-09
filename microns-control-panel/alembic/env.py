"""Alembic environment for the control panel.

Same arrangement as the engine's: the URL comes from ``app.config.settings`` so
a deployment configures ``DATABASE_URL`` and nothing else, but an explicit
``sqlalchemy.url`` on the Config wins so the tests can drive the chain against
a scratch database.
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

# Only when Alembic is driven from the command line.
#
# ``fileConfig`` defaults to ``disable_existing_loggers=True``: it disables
# every logger that already exists and resets the root level to alembic.ini's
# WARNING. Called from inside application startup — which is where migrations
# actually run on Railway — that silences the application for the rest of the
# process's life. The symptom is not an error; it is a service that logs its
# startup warnings, runs its migrations, and then never says anything again,
# which is indistinguishable in the deploy log from a process that hung.
#
# The app sets this attribute in ``_alembic_config`` because it has configured
# logging already and does not want it taken away.
if config.config_file_name is not None and config.attributes.get("configure_logging", True):
    fileConfig(config.config_file_name)

# ``settings`` is a cached singleton read once at import, so it cannot see a
# database chosen after the fact. An explicit URL on the Config therefore wins.
if not config.get_main_option("sqlalchemy.url", None):
    config.set_main_option("sqlalchemy.url", settings.sqlalchemy_url)

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to):
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
