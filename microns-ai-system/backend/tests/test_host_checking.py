"""Host checking in production, and the one path exempt from it.

Host checking exists to stop DNS rebinding and Host-header poisoning. The
platform's healthcheck is the exception, and it is not a cosmetic one: with the
probe rejected, a clinic's engine that works perfectly never becomes healthy
and is killed for it, with nothing in the deploy log to say why.

The provisioner sets ALLOWED_HOSTS on every clinic it builds, so this is the
configuration every clinic actually runs in.
"""

from __future__ import annotations

import importlib

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient


@pytest.fixture()
def production_app(monkeypatch, tmp_path):
    """The engine as a provisioned clinic runs it, with host checking on."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_HOSTS", "care.glowaesthetics.com")
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("FINGERPRINT_SECRET", "a-real-fingerprint-secret")
    monkeypatch.setenv("INTERNAL_API_TOKEN", "a-real-internal-token")
    monkeypatch.setenv("STAFF_API_TOKEN", "a-real-staff-token")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'host.db'}")

    import app.config
    import app.main

    # The module-level ``settings`` singleton has to be put back exactly as it
    # was. Other tests read it for their own database path, and leaving a
    # production-shaped object behind sends them at the wrong sqlite file — a
    # failure that shows up in unrelated modules and looks nothing like its
    # cause.
    original_settings = app.config.settings
    app.config.get_settings.cache_clear()
    app.config.settings = app.config.get_settings()

    module = importlib.reload(app.main)
    try:
        yield module
    finally:
        app.config.settings = original_settings
        app.config.get_settings.cache_clear()
        importlib.reload(app.main)


def test_the_healthcheck_answers_whatever_host_the_platform_uses(production_app):
    """Railway probes from inside its network with its own Host header.

    If this 400s, the clinic's engine sits in "Deploying" until it is killed
    while serving every real request correctly.
    """
    with TestClient(production_app.app) as client:
        response = client.get("/health", headers={"Host": "healthcheck.railway.app"})
    assert response.status_code == 200, (
        "the platform's liveness probe must not be host-checked, or the "
        "clinic's engine never becomes healthy"
    )


def test_every_other_path_is_still_host_checked(production_app):
    """The exemption is one path, not a hole in the middleware."""
    with TestClient(production_app.app) as client:
        response = client.get("/api/leads", headers={"Host": "attacker.example.com"})
    assert response.status_code == 400


def test_the_clinics_own_hostname_is_accepted(production_app):
    with TestClient(production_app.app) as client:
        response = client.get("/health", headers={"Host": "care.glowaesthetics.com"})
        assert response.status_code == 200
