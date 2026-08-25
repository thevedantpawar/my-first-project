"""Test fixtures.

Environment is configured **before** any app module is imported, because
``app.config.settings`` and ``app.database.engine`` are module-level singletons
built at import time.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="microns-tests-"))

os.environ.update(
    {
        "ENVIRONMENT": "test",
        "LOG_LEVEL": "WARNING",
        "DATABASE_URL": f"sqlite:///{_TMP / 'test.db'}",
        # Fixed key so ciphertext assertions are stable across the session.
        "ENCRYPTION_KEY": "0Wl8Vv3s5rN7yQzXk2hJ4pT6dF8gB1cA3eR5tY7uI9o=",
        "FINGERPRINT_SECRET": "test-fingerprint-secret",
        "INTERNAL_API_TOKEN": "test-internal-token",
        "STAFF_API_TOKEN": "test-staff-token",
        "VAPI_WEBHOOK_SECRET": "test-vapi-secret",
        "CLINIC_NAME": "Test Med Spa",
        "CLINIC_TIMEZONE": "America/New_York",
        "CLINIC_PHONE": "+15550000000",
        # No third-party calls from the test suite.
        "OPENAI_API_KEY": "",
        "TWILIO_ACCOUNT_SID": "",
        "TWILIO_AUTH_TOKEN": "",
        "TWILIO_VALIDATE_SIGNATURE": "false",
        "N8N_WEBHOOK_BASE_URL": "",
        "REACTIVATION_DAYS": "45",
        "REVIEW_REQUEST_DELAY_DAYS": "5",
    }
)

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.patient import Patient  # noqa: E402
from app.utils import utcnow  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    init_db()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _clean_tables():
    """Empty every table between tests so ordering never matters."""
    yield
    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    """The limiters are process-global; without this, test order changes results."""
    from app.ratelimit import chat_limiter, qualify_limiter

    for limiter in (chat_limiter, qualify_limiter):
        limiter._hits.clear()
    yield


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def staff_headers() -> dict[str, str]:
    return {"X-Staff-Token": "test-staff-token"}


@pytest.fixture
def internal_headers() -> dict[str, str]:
    return {"X-Internal-Token": "test-internal-token"}


@pytest.fixture
def vapi_headers() -> dict[str, str]:
    return {"X-Vapi-Secret": "test-vapi-secret"}


@pytest.fixture
def patient(db) -> Patient:
    record = Patient.create(
        phone="+15551234567",
        name="Jane Doe",
        email="jane@example.com",
        sms_consent=True,
        marketing_consent=True,
    )
    record.last_visit_at = utcnow()
    db.add(record)
    db.commit()
    return record
