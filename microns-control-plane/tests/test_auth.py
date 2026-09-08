"""Authentication.

Weighted towards the properties that are easy to lose in a refactor and
expensive to lose in production: that an unauthenticated caller cannot
enumerate accounts, that a password change actually invalidates sessions, and
that a reset token is single-use.
"""

from __future__ import annotations

from datetime import timedelta

from app.config import settings
from app.models.account import Account
from app.models.audit_event import AuditAction, AuditEvent
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.user import User
from app.services import accounts, passwords, sessions
from app.utils import utcnow


# --------------------------------------------------------------------------- #
# Signup
# --------------------------------------------------------------------------- #
def test_signup_creates_account_owner_and_subscription(client, db):
    response = client.post(
        "/api/auth/signup",
        json={
            "account_name": "Glow Aesthetics Group",
            "name": "Dana Reyes",
            "email": "Dana@Glow.Example.Com",
            "password": "a-sufficiently-long-password",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["authenticated"] is True
    assert body["user"]["is_owner"] is True

    user = db.query(User).one()
    # Stored lowercased, so "Dana@" and "dana@" are the same account.
    assert user.email == "dana@glow.example.com"
    assert user.is_owner is True

    account = db.query(Account).one()
    assert account.slug == "glow-aesthetics-group"
    assert account.is_staff is False, "signup must never mint an operator"

    subscription = db.query(Subscription).one()
    assert subscription.status == SubscriptionStatus.NONE
    assert subscription.is_entitled is False


def test_signup_never_stores_the_password(client, db):
    secret = "a-sufficiently-long-password"
    client.post(
        "/api/auth/signup",
        json={"account_name": "A", "email": "owner@a.example.com", "password": secret},
    )
    user = db.query(User).one()
    assert secret not in user.password_hash
    assert user.password_hash.startswith("$argon2id$")


def test_signup_rejects_a_short_password(client):
    response = client.post(
        "/api/auth/signup",
        json={"account_name": "A", "email": "owner@a.example.com", "password": "short"},
    )
    assert response.status_code == 400
    assert str(settings.password_min_length) in response.json()["detail"]


def test_duplicate_signup_is_rejected(client, signed_up):
    response = client.post(
        "/api/auth/signup",
        json={
            "account_name": "Another",
            "email": signed_up["email"].upper(),
            "password": "a-different-long-password",
        },
    )
    assert response.status_code == 409


def test_slug_collision_gets_a_suffix(client, db):
    for email in ("one@x.example.com", "two@x.example.com"):
        client.post(
            "/api/auth/signup",
            json={
                "account_name": "Glow Aesthetics",
                "email": email,
                "password": "a-sufficiently-long-password",
            },
        )
    slugs = sorted(a.slug for a in db.query(Account).all())
    assert slugs == ["glow-aesthetics", "glow-aesthetics-2"], (
        "slugs become Railway service names — a collision is two clinics "
        "contending for one hostname"
    )


# --------------------------------------------------------------------------- #
# Login
# --------------------------------------------------------------------------- #
def test_login_succeeds_and_sets_a_session_cookie(client, signed_up):
    client.cookies.clear()
    response = client.post(
        "/api/auth/login",
        json={"email": signed_up["email"], "password": signed_up["password"]},
    )
    assert response.status_code == 200
    assert settings.session_cookie_name in response.cookies

    session = client.get("/api/auth/session")
    assert session.json()["authenticated"] is True


def test_login_is_case_insensitive_on_the_address(client, signed_up):
    client.cookies.clear()
    response = client.post(
        "/api/auth/login",
        json={"email": signed_up["email"].upper(), "password": signed_up["password"]},
    )
    assert response.status_code == 200


def test_wrong_password_and_unknown_address_are_indistinguishable(client, signed_up):
    """The response must not reveal whether an address has an account.

    Anything that distinguishes them turns this endpoint into a list of which
    clinics are customers.
    """
    client.cookies.clear()
    wrong_password = client.post(
        "/api/auth/login",
        json={"email": signed_up["email"], "password": "not-the-right-password"},
    )
    unknown_address = client.post(
        "/api/auth/login",
        json={"email": "nobody@nowhere.example.com", "password": "not-the-right-password"},
    )

    assert wrong_password.status_code == unknown_address.status_code == 401
    assert wrong_password.json() == unknown_address.json()


def test_failed_login_is_audited(client, signed_up, db):
    client.cookies.clear()
    client.post(
        "/api/auth/login",
        json={"email": signed_up["email"], "password": "wrong-password-here"},
    )
    events = db.query(AuditEvent).filter(AuditEvent.action == AuditAction.LOGIN_FAILED).all()
    assert len(events) == 1
    assert events[0].actor_email == signed_up["email"]
    assert events[0].outcome == "denied"


def test_login_is_rate_limited_per_address(client, signed_up):
    client.cookies.clear()
    statuses = [
        client.post(
            "/api/auth/login",
            json={"email": signed_up["email"], "password": "wrong-password-here"},
        ).status_code
        for _ in range(12)
    ]
    assert 429 in statuses, "a password list must not be walkable"


def test_a_deactivated_user_cannot_sign_in(client, signed_up, db):
    user = db.query(User).one()
    user.is_active = False
    db.commit()

    client.cookies.clear()
    response = client.post(
        "/api/auth/login",
        json={"email": signed_up["email"], "password": signed_up["password"]},
    )
    assert response.status_code == 401


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
def test_session_is_rejected_without_a_cookie(client):
    response = client.get("/api/auth/session")
    assert response.json() == {"authenticated": False, "user": None}


def test_a_forged_cookie_is_rejected(client, signed_up):
    client.cookies.set(settings.session_cookie_name, "not-a-real-signed-token")
    assert client.get("/api/auth/session").json()["authenticated"] is False


def test_a_cookie_signed_with_another_secret_is_rejected(client, signed_up, db, monkeypatch):
    """A token minted under a different SESSION_SECRET must not verify."""
    user = db.query(User).one()
    monkeypatch.setattr(settings, "session_secret", "a-completely-different-secret")
    forged = sessions.issue(str(user.id), str(user.session_epoch))
    monkeypatch.undo()

    client.cookies.set(settings.session_cookie_name, forged)
    assert client.get("/api/auth/session").json()["authenticated"] is False


def test_logout_clears_the_session(client, signed_up):
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/session").json()["authenticated"] is False


def test_logout_without_a_session_still_succeeds(client):
    """A sign-out that can fail strands somebody on a page they cannot leave."""
    assert client.post("/api/auth/logout").status_code == 200


# --------------------------------------------------------------------------- #
# Password change and reset
# --------------------------------------------------------------------------- #
def test_changing_a_password_invalidates_other_sessions(client, signed_up):
    """The property a plain signed cookie cannot normally provide.

    A second browser holding a valid cookie must stop working the moment the
    password changes — that is the whole point of changing it.
    """
    stolen = client.cookies.get(settings.session_cookie_name)

    response = client.post(
        "/api/auth/password/change",
        json={
            "current_password": signed_up["password"],
            "new_password": "a-brand-new-long-password",
        },
    )
    assert response.status_code == 200

    other_browser = client
    other_browser.cookies.clear()
    other_browser.cookies.set(settings.session_cookie_name, stolen)
    assert other_browser.get("/api/auth/session").json()["authenticated"] is False


def test_password_change_requires_the_current_password(client, signed_up):
    response = client.post(
        "/api/auth/password/change",
        json={"current_password": "not-the-current-one", "new_password": "a-new-long-password"},
    )
    assert response.status_code == 400
    # And the old password must still work.
    client.cookies.clear()
    assert (
        client.post(
            "/api/auth/login",
            json={"email": signed_up["email"], "password": signed_up["password"]},
        ).status_code
        == 200
    )


def test_password_change_enforces_policy(client, signed_up):
    response = client.post(
        "/api/auth/password/change",
        json={"current_password": signed_up["password"], "new_password": "short"},
    )
    assert response.status_code == 400


def test_reset_request_says_the_same_thing_for_unknown_addresses(client, signed_up):
    known = client.post("/api/auth/password/reset-request", json={"email": signed_up["email"]})
    unknown = client.post("/api/auth/password/reset-request", json={"email": "no@one.example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()


def test_reset_token_is_stored_only_as_a_hash(client, signed_up, db):
    result = accounts.begin_password_reset(db, email=signed_up["email"])
    assert result is not None
    user, token = result
    db.commit()

    assert user.reset_token_hash is not None
    assert token not in user.reset_token_hash, (
        "a database dump must not yield working reset links"
    )


def test_reset_completes_and_the_token_is_single_use(client, signed_up, db):
    result = accounts.begin_password_reset(db, email=signed_up["email"])
    _, token = result
    db.commit()

    first = client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": "a-freshly-reset-password"},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": "another-attempt-password"},
    )
    assert second.status_code == 400, "a reset token must not be replayable"

    client.cookies.clear()
    assert (
        client.post(
            "/api/auth/login",
            json={"email": signed_up["email"], "password": "a-freshly-reset-password"},
        ).status_code
        == 200
    )


def test_an_expired_reset_token_is_refused(client, signed_up, db):
    result = accounts.begin_password_reset(db, email=signed_up["email"])
    user, token = result
    user.reset_token_expires_at = utcnow() - timedelta(minutes=1)
    db.commit()

    response = client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": "a-freshly-reset-password"},
    )
    assert response.status_code == 400


def test_reset_signs_out_existing_sessions(client, signed_up, db):
    stolen = client.cookies.get(settings.session_cookie_name)

    _, token = accounts.begin_password_reset(db, email=signed_up["email"])
    db.commit()
    client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": "a-freshly-reset-password"},
    )

    client.cookies.clear()
    client.cookies.set(settings.session_cookie_name, stolen)
    assert client.get("/api/auth/session").json()["authenticated"] is False


# --------------------------------------------------------------------------- #
# Hashing
# --------------------------------------------------------------------------- #
def test_hashes_are_salted_per_password():
    a = passwords.hash_password("a-sufficiently-long-password")
    b = passwords.hash_password("a-sufficiently-long-password")
    assert a != b, "identical passwords must not produce identical hashes"


def test_a_hash_made_under_weaker_parameters_is_upgraded_on_login(monkeypatch):
    """Raising the cost settings must not invalidate anybody's password."""
    from argon2 import PasswordHasher

    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    old_hash = weak.hash("a-sufficiently-long-password")

    ok, upgraded = passwords.verify("a-sufficiently-long-password", old_hash)
    assert ok is True
    assert upgraded is not None and upgraded != old_hash


def test_verify_against_a_missing_hash_is_false_not_an_error():
    ok, upgraded = passwords.verify("anything-at-all-here", None)
    assert ok is False and upgraded is None
