"""Test configuration.

The environment is set before anything imports ``app.config``, because
``settings`` is a cached singleton built at import time.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="microns-control-tests-"))

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TMP / 'control.db'}")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-not-used-anywhere-real")
os.environ.setdefault("LOG_LEVEL", "WARNING")
# A real Fernet key, so sealing is exercised rather than skipped.
from cryptography.fernet import Fernet  # noqa: E402

os.environ.setdefault("MASTER_KEY", Fernet.generate_key().decode())

# Argon2 at test cost. The production parameters are deliberately expensive,
# and several hundred hashes at 64 MiB each would dominate the run.
os.environ.setdefault("ARGON2_TIME_COST", "1")
os.environ.setdefault("ARGON2_MEMORY_COST_KIB", "8192")
os.environ.setdefault("ARGON2_PARALLELISM", "1")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.ratelimit import login_limiter, reset_limiter, signup_limiter  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    init_db()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _clean_state():
    """Empty every table and reset the limiters between tests.

    The limiters are process-global; without this, a test that exhausts the
    login window makes every later test fail with a 429.
    """
    yield
    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())
    login_limiter.reset()
    signup_limiter.reset()
    reset_limiter.reset()


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def signed_up(client):
    """An account with a signed-in owner. Returns the signup payload."""
    payload = {
        "account_name": "Glow Aesthetics Group",
        "name": "Dana Reyes",
        "email": "dana@glow.example.com",
        "password": "a-sufficiently-long-password",
    }
    response = client.post("/api/auth/signup", json=payload)
    assert response.status_code == 201, response.text
    return payload
