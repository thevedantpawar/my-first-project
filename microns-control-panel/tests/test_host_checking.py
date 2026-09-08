"""Host checking in production, and the one path exempt from it.

Host checking exists to stop DNS rebinding and Host-header poisoning. The
platform's healthcheck is the exception, and it is not a cosmetic one: with the
probe rejected, a deployment that works perfectly never becomes healthy and is
killed for it, with nothing in the log to say why.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def production_app(monkeypatch, tmp_path):
    """The app as it is built in production, with host checking on."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ALLOWED_HOSTS", "control.example.com")
    monkeypatch.setenv("MASTER_KEY", "8AolEyLq7QYY8ga48QZk9GoNxYNYFPWbQuSfODlDavc=")
    monkeypatch.setenv("SESSION_SECRET", "a-real-session-secret-for-this-test")
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

    If this 400s, the deployment sits in "Deploying" until it is killed while
    serving every real request correctly — which is exactly what happened.
    """
    with TestClient(production_app.app) as client:
        response = client.get("/health", headers={"Host": "healthcheck.railway.app"})
    assert response.status_code == 200, (
        "the platform's liveness probe must not be host-checked, or the "
        "deployment never becomes healthy"
    )


def test_every_other_path_is_still_host_checked(production_app):
    """The exemption is one path, not a hole in the middleware."""
    with TestClient(production_app.app) as client:
        response = client.get("/api/clinics", headers={"Host": "attacker.example.com"})
    assert response.status_code == 400


def test_the_real_hostname_is_accepted(production_app):
    with TestClient(production_app.app) as client:
        assert client.get("/health", headers={"Host": "control.example.com"}).status_code == 200
