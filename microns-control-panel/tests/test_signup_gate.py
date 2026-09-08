"""Who may create an account.

This service holds the sealed copy of every clinic's encryption key. It is not
a self-serve product, so an open sign-up page is a way in for anyone who finds
the URL.

The awkward part is bootstrapping: a door closed with nobody behind it is not
security, it is a deployment that can only be recovered by editing the database
by hand. Hence the first-account exemption, and hence these tests.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.models.account import Account


@pytest.fixture()
def closed(monkeypatch):
    """Sign-up as it is configured in production."""
    monkeypatch.setattr(settings, "allow_public_signup", False, raising=False)
    return settings


def _signup(client, email="first@example.com", name="First Practice"):
    return client.post(
        "/api/auth/signup",
        json={
            "account_name": name,
            "email": email,
            "password": "a-sufficiently-long-password",
        },
    )


def test_the_first_account_is_always_allowed(client, db, closed):
    """Otherwise a fresh deployment has nobody who can administer it.

    This is what makes shipping the closed default safe: it cannot lock out an
    operator who has not signed up yet.
    """
    assert db.query(Account).count() == 0
    assert _signup(client).status_code == 201


def test_the_second_account_is_refused(client, db, closed):
    assert _signup(client).status_code == 201
    client.cookies.clear()

    response = _signup(client, email="stranger@example.com", name="Stranger Co")
    assert response.status_code == 403
    assert db.query(Account).count() == 1, "no row is written for a refused signup"


def test_the_refusal_says_what_to_do_instead(client, closed):
    _signup(client)
    client.cookies.clear()
    detail = _signup(client, email="stranger@example.com").json()["detail"]
    assert "owner" in detail.lower(), detail


def test_opening_it_deliberately_works(client, db, monkeypatch):
    """Becoming a self-serve product is a decision somebody makes."""
    monkeypatch.setattr(settings, "allow_public_signup", False, raising=False)
    assert _signup(client).status_code == 201
    client.cookies.clear()

    monkeypatch.setattr(settings, "allow_public_signup", True, raising=False)
    assert _signup(client, email="welcome@example.com", name="Welcome Co").status_code == 201
    assert db.query(Account).count() == 2


def test_signing_in_still_works_when_signup_is_closed(client, closed):
    """Closing the door must not lock in the people already inside."""
    _signup(client)
    client.cookies.clear()

    response = client.post(
        "/api/auth/login",
        json={"email": "first@example.com", "password": "a-sufficiently-long-password"},
    )
    assert response.status_code == 200
    assert response.json()["authenticated"] is True
