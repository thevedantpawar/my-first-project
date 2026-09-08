"""Billing, entitlement, and the tenant boundary.

The rule under test throughout: a billing problem suspends, it never destroys.
A clinic whose card lapsed must come back with its records intact, because the
alternative is deleting a medical practice's patient history over a declined
payment.
"""

from __future__ import annotations

import pytest

from app.models.account import Account
from app.models.audit_event import AuditAction, AuditEvent
from app.models.clinic import Clinic, ClinicStatus
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.user import User
from app.services import billing
from tests.test_provisioning import FakeRailway


@pytest.fixture()
def entitled(db, signed_up):
    """An account with an active subscription."""
    subscription = db.query(Subscription).one()
    subscription.status = SubscriptionStatus.ACTIVE
    subscription.plan = "starter"
    subscription.clinic_limit = 1
    db.commit()
    return subscription


# --------------------------------------------------------------------------- #
# Entitlement
# --------------------------------------------------------------------------- #
def test_past_due_still_entitles_service():
    """A card that failed this morning must not end the phone line today.

    Stripe's own dunning gets its retry window before anything is suspended.
    """
    subscription = Subscription(status=SubscriptionStatus.PAST_DUE)
    assert subscription.is_entitled is True


@pytest.mark.parametrize(
    "status,entitled",
    [
        (SubscriptionStatus.TRIALING, True),
        (SubscriptionStatus.ACTIVE, True),
        (SubscriptionStatus.PAST_DUE, True),
        (SubscriptionStatus.CANCELED, False),
        (SubscriptionStatus.UNPAID, False),
        (SubscriptionStatus.NONE, False),
        (SubscriptionStatus.INCOMPLETE, False),
    ],
)
def test_entitlement_by_status(status, entitled):
    assert Subscription(status=status).is_entitled is entitled


def test_a_clinic_cannot_be_created_without_a_subscription(client, signed_up):
    response = client.post("/api/clinics", json={"name": "Glow Aesthetics"})
    assert response.status_code == 402
    assert "subscription" in response.json()["detail"].lower()


def test_the_plan_limit_is_enforced_before_anything_is_built(client, entitled):
    """Hitting the limit must happen before infrastructure exists, not during."""
    first = client.post("/api/clinics", json={"name": "Glow Aesthetics"})
    assert first.status_code == 201

    second = client.post("/api/clinics", json={"name": "Glow Downtown"})
    assert second.status_code == 402
    assert "upgrade" in second.json()["detail"].lower()


def test_a_higher_plan_allows_more_clinics(client, db, entitled):
    entitled.plan = "growth"
    entitled.clinic_limit = billing.PLANS["growth"]["clinic_limit"]
    db.commit()

    for name in ("Glow One", "Glow Two", "Glow Three"):
        assert client.post("/api/clinics", json={"name": name}).status_code == 201


def test_archived_clinics_do_not_count_against_the_limit(client, db, entitled):
    """Trying a clinic and shutting it down must not cost a slot forever."""
    client.post("/api/clinics", json={"name": "Glow Aesthetics"})
    clinic = db.query(Clinic).one()
    clinic.status = ClinicStatus.ARCHIVED
    db.commit()

    assert client.post("/api/clinics", json={"name": "Glow Downtown"}).status_code == 201


# --------------------------------------------------------------------------- #
# Suspension and resumption
# --------------------------------------------------------------------------- #
def _provisioned_clinic(db, account):
    from app.services.provisioning import Provisioner

    clinic = Clinic(
        account_id=account.id, name="Glow Aesthetics", slug="glow-aesthetics", integrations={}
    )
    db.add(clinic)
    db.commit()
    Provisioner(db, clinic, client=FakeRailway()).provision()
    return clinic


def test_losing_entitlement_suspends_but_keeps_everything(db, signed_up, entitled):
    account = db.query(Account).one()
    clinic = _provisioned_clinic(db, account)
    key_before = clinic.encryption_key
    volume_before = clinic.railway_volume_id

    entitled.status = SubscriptionStatus.CANCELED
    db.commit()
    billing.reconcile_clinics(db, account, client=FakeRailway())

    db.expire_all()
    stored = db.query(Clinic).one()
    assert stored.status == ClinicStatus.SUSPENDED
    # The whole point: nothing about the clinic's data was touched.
    assert stored.encryption_key == key_before
    assert stored.railway_volume_id == volume_before


def test_regaining_entitlement_resumes(db, signed_up, entitled):
    account = db.query(Account).one()
    _provisioned_clinic(db, account)

    entitled.status = SubscriptionStatus.CANCELED
    db.commit()
    billing.reconcile_clinics(db, account, client=FakeRailway())
    assert db.query(Clinic).one().status == ClinicStatus.SUSPENDED

    entitled.status = SubscriptionStatus.ACTIVE
    db.commit()
    billing.reconcile_clinics(db, account, client=FakeRailway())

    db.expire_all()
    assert db.query(Clinic).one().status == ClinicStatus.ACTIVE


def test_reconciling_never_deletes(db, signed_up, entitled):
    account = db.query(Account).one()
    _provisioned_clinic(db, account)

    fake = FakeRailway()
    entitled.status = SubscriptionStatus.UNPAID
    db.commit()
    billing.reconcile_clinics(db, account, client=fake)

    assert "delete_service" not in fake.call_names()
    assert "delete_project" not in fake.call_names()
    assert db.query(Clinic).count() == 1


# --------------------------------------------------------------------------- #
# Webhooks
# --------------------------------------------------------------------------- #
def test_an_unsigned_webhook_is_rejected(client, monkeypatch):
    """The signature is all that stands between this URL and free service."""
    monkeypatch.setattr("app.config.settings.stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr("app.config.settings.stripe_api_key", "sk_test")

    response = client.post("/api/billing/webhook", content=b'{"type":"whatever"}')
    assert response.status_code == 400


def test_a_webhook_is_refused_when_no_secret_is_configured(client):
    """Refused rather than skipped — an unset secret must not mean 'trust it'."""
    response = client.post(
        "/api/billing/webhook",
        content=b'{"type":"customer.subscription.updated"}',
        headers={"Stripe-Signature": "t=1,v1=nonsense"},
    )
    assert response.status_code == 503


def test_subscription_state_is_applied_from_a_stripe_object(db, signed_up, monkeypatch):
    monkeypatch.setattr("app.config.settings.stripe_price_id_growth", "price_growth")
    account = db.query(Account).one()

    billing.apply_subscription_state(
        db,
        {
            "id": "sub_123",
            "customer": "cus_123",
            "status": "active",
            "current_period_end": 1800000000,
            "metadata": {"account_id": str(account.id)},
            "items": {"data": [{"price": {"id": "price_growth"}}]},
        },
    )
    db.commit()

    record = db.query(Subscription).one()
    assert record.status == "active"
    assert record.stripe_customer_id == "cus_123"
    assert record.stripe_subscription_id == "sub_123"
    # The plan is derived from the price, not trusted from metadata.
    assert record.plan == "growth"
    assert record.clinic_limit == billing.PLANS["growth"]["clinic_limit"]


def test_a_cancellation_event_suspends_the_clinics(db, signed_up, entitled):
    account = db.query(Account).one()
    _provisioned_clinic(db, account)

    billing.handle_event(
        db,
        {
            "type": "customer.subscription.deleted",
            "data": {
                "object": {
                    "id": "sub_123",
                    "customer": "cus_123",
                    "status": "canceled",
                    "metadata": {"account_id": str(account.id)},
                    "items": {"data": []},
                }
            },
        },
        client=FakeRailway(),
    )

    db.expire_all()
    assert db.query(Clinic).one().status == ClinicStatus.SUSPENDED


def test_a_failed_invoice_alone_does_not_suspend(db, signed_up, entitled):
    """Stripe retries the card first; suspending on the first failure is wrong."""
    account = db.query(Account).one()
    _provisioned_clinic(db, account)

    billing.handle_event(
        db,
        {"type": "invoice.payment_failed", "data": {"object": {"customer": "cus_123"}}},
        client=FakeRailway(),
    )

    db.expire_all()
    assert db.query(Clinic).one().status == ClinicStatus.ACTIVE


def test_an_event_for_an_unknown_account_is_ignored_not_an_error(db):
    result = billing.handle_event(
        db,
        {
            "type": "customer.subscription.updated",
            "data": {"object": {"id": "sub_x", "customer": "cus_x", "metadata": {}}},
        },
    )
    assert result["handled"] is False


# --------------------------------------------------------------------------- #
# The tenant boundary
# --------------------------------------------------------------------------- #
@pytest.fixture()
def two_accounts(client, db):
    """Two separate accounts, each with a clinic. Returns both sign-ins."""
    first = {
        "account_name": "Glow Group",
        "email": "one@glow.example.com",
        "password": "a-sufficiently-long-password",
    }
    second = {
        "account_name": "Radiance Group",
        "email": "two@radiance.example.com",
        "password": "a-sufficiently-long-password",
    }
    for payload in (first, second):
        client.cookies.clear()
        assert client.post("/api/auth/signup", json=payload).status_code == 201

    for account in db.query(Account).all():
        sub = db.query(Subscription).filter(Subscription.account_id == account.id).one()
        sub.status = SubscriptionStatus.ACTIVE
        db.add(Clinic(account_id=account.id, name=f"{account.name} Clinic",
                      slug=f"{account.slug}-clinic", integrations={}))
    db.commit()
    return first, second


def test_one_account_cannot_read_anothers_clinic(client, db, two_accounts):
    first, second = two_accounts

    client.cookies.clear()
    client.post("/api/auth/login", json={"email": second["email"], "password": second["password"]})
    others = client.get("/api/clinics").json()
    assert len(others) == 1
    other_id = others[0]["id"]

    client.cookies.clear()
    client.post("/api/auth/login", json={"email": first["email"], "password": first["password"]})

    # A clinic belonging to somebody else is a 404, not a 403 — a 403 would
    # confirm the id is real.
    assert client.get(f"/api/clinics/{other_id}").status_code == 404
    assert client.patch(f"/api/clinics/{other_id}", json={"name": "Hijacked"}).status_code == 404
    assert client.post(f"/api/clinics/{other_id}/provision").status_code == 404
    assert client.get(f"/api/clinics/{other_id}/encryption-key").status_code == 404


def test_listing_clinics_only_returns_your_own(client, db, two_accounts):
    first, _ = two_accounts
    client.cookies.clear()
    client.post("/api/auth/login", json={"email": first["email"], "password": first["password"]})

    body = client.get("/api/clinics").json()
    assert len(body) == 1
    assert body[0]["name"].startswith("Glow")
    assert db.query(Clinic).count() == 2, "the other account's clinic still exists"


def test_clinic_responses_never_carry_a_secret(client, db, entitled):
    from app.services.provisioning import Provisioner

    account = db.query(Account).one()
    clinic = Clinic(account_id=account.id, name="Glow", slug="glow", integrations={})
    db.add(clinic)
    db.commit()
    Provisioner(db, clinic, client=FakeRailway()).provision()

    body = client.get(f"/api/clinics/{clinic.id}").text
    for secret in (clinic.encryption_key, clinic.staff_api_token, clinic.internal_api_token):
        assert secret not in body, "a clinic response must not leak a secret"


# --------------------------------------------------------------------------- #
# Key escrow
# --------------------------------------------------------------------------- #
def test_revealing_the_encryption_key_is_audited(client, db, entitled):
    from app.services.provisioning import Provisioner

    account = db.query(Account).one()
    clinic = Clinic(account_id=account.id, name="Glow", slug="glow", integrations={})
    db.add(clinic)
    db.commit()
    Provisioner(db, clinic, client=FakeRailway()).provision()

    response = client.get(f"/api/clinics/{clinic.id}/encryption-key")
    assert response.status_code == 200
    assert response.json()["encryption_key"] == clinic.encryption_key

    events = db.query(AuditEvent).filter(AuditEvent.action == AuditAction.KEY_REVEALED).all()
    assert len(events) == 1, "every read of an escrowed key must leave a row"
    assert str(events[0].clinic_id) == str(clinic.id)


def test_a_non_owner_cannot_reveal_the_key(client, db, entitled):
    from app.services.provisioning import Provisioner

    account = db.query(Account).one()
    clinic = Clinic(account_id=account.id, name="Glow", slug="glow", integrations={})
    db.add(clinic)
    db.commit()
    Provisioner(db, clinic, client=FakeRailway()).provision()

    user = db.query(User).one()
    user.is_owner = False
    db.commit()

    assert client.get(f"/api/clinics/{clinic.id}/encryption-key").status_code == 403


def test_an_unreadable_clinic_secret_does_not_break_sign_in(client, db, entitled, monkeypatch):
    """A key-rotation mistake must not lock everyone out of the console.

    Sealed columns are deferred precisely so that unsealing failures surface on
    the one endpoint that asks for a key, rather than on whatever query
    happened to load a clinic row — sign-in among them, which reaches clinics
    through the account relationship.
    """
    from cryptography.fernet import Fernet

    from app.services import crypto
    from app.services.provisioning import Provisioner

    account = db.query(Account).one()
    clinic = Clinic(account_id=account.id, name="Glow", slug="glow", integrations={})
    db.add(clinic)
    db.commit()
    Provisioner(db, clinic, client=FakeRailway()).provision()
    clinic_id = str(clinic.id)

    # Rotate the master key without listing the old one — the mistake.
    monkeypatch.setattr(crypto.settings, "master_key", Fernet.generate_key().decode())
    monkeypatch.setattr(crypto.settings, "master_keys_old", [])
    crypto.reset_sealer()

    try:
        client.cookies.clear()
        signed_in = client.post(
            "/api/auth/login",
            json={"email": "dana@glow.example.com", "password": "a-sufficiently-long-password"},
        )
        assert signed_in.status_code == 200, "sign-in must not depend on clinic secrets"

        # The console still works, so the operator can see what is wrong.
        assert client.get("/api/clinics").status_code == 200
        assert client.get(f"/api/clinics/{clinic_id}").status_code == 200

        # Only the endpoint that actually needs the key fails. TestClient
        # re-raises server exceptions rather than rendering the 500 the
        # exception handler would return in production, so the failure is
        # asserted as the exception itself.
        with pytest.raises(crypto.SealingError):
            client.get(f"/api/clinics/{clinic_id}/encryption-key")
    finally:
        crypto.reset_sealer()
