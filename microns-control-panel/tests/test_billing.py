"""Billing, entitlement, and the tenant boundary.

The rule under test throughout: a billing problem suspends, it never destroys.
A clinic whose card lapsed must come back with its records intact, because the
alternative is deleting a medical practice's patient history over a declined
payment.
"""

from __future__ import annotations

import hashlib
import hmac
import json

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

    Razorpay's own retry schedule gets its window before anything is suspended.
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
def _signed(payload: bytes, secret: str = "whsec_test") -> dict:
    """Razorpay's signature: HMAC-SHA256 of the raw body, hex."""
    return {
        "X-Razorpay-Signature": hmac.new(
            secret.encode(), payload, hashlib.sha256
        ).hexdigest()
    }


def _subscription_event(event: str, account_id, **entity) -> dict:
    body = {
        "id": "sub_RZP123",
        "plan_id": "plan_growth",
        "status": "active",
        "notes": {"account_id": str(account_id)},
    }
    body.update(entity)
    return {"event": event, "payload": {"subscription": {"entity": body}}}


def test_an_unsigned_webhook_is_rejected(client, monkeypatch):
    """The signature is all that stands between this URL and free service."""
    monkeypatch.setattr("app.config.settings.razorpay_webhook_secret", "whsec_test")

    response = client.post("/api/billing/webhook", content=b'{"event":"whatever"}')
    assert response.status_code == 400


def test_a_forged_signature_is_rejected(client, monkeypatch):
    monkeypatch.setattr("app.config.settings.razorpay_webhook_secret", "whsec_test")

    response = client.post(
        "/api/billing/webhook",
        content=b'{"event":"subscription.activated"}',
        headers={"X-Razorpay-Signature": "0" * 64},
    )
    assert response.status_code == 400


def test_a_signature_over_different_bytes_is_rejected(client, monkeypatch):
    """The raw body is what is signed.

    Signing a re-serialised copy produces a valid-looking digest over the wrong
    bytes, which is how a body gets tampered with in transit and still passes.
    """
    monkeypatch.setattr("app.config.settings.razorpay_webhook_secret", "whsec_test")

    signed_over = b'{"event":"subscription.activated"}'
    actually_sent = b'{"event": "subscription.activated"}'  # one space
    assert signed_over != actually_sent

    response = client.post(
        "/api/billing/webhook", content=actually_sent, headers=_signed(signed_over)
    )
    assert response.status_code == 400


def test_a_correctly_signed_webhook_is_accepted(client, monkeypatch):
    monkeypatch.setattr("app.config.settings.razorpay_webhook_secret", "whsec_test")

    body = json.dumps({"event": "payment.captured"}).encode()
    response = client.post("/api/billing/webhook", content=body, headers=_signed(body))
    assert response.status_code == 200
    assert response.json()["received"] is True


def test_a_webhook_is_refused_when_no_secret_is_configured(client, monkeypatch):
    """Refused rather than skipped — an unset secret must not mean 'trust it'."""
    monkeypatch.setattr("app.config.settings.razorpay_webhook_secret", None)

    response = client.post(
        "/api/billing/webhook",
        content=b'{"event":"subscription.activated"}',
        headers={"X-Razorpay-Signature": "nonsense"},
    )
    assert response.status_code == 503


def test_subscription_state_is_applied_from_a_razorpay_entity(db, signed_up, monkeypatch):
    monkeypatch.setattr("app.config.settings.razorpay_plan_id_growth", "plan_growth")
    account = db.query(Account).one()

    billing.apply_subscription_state(
        db,
        {
            "id": "sub_RZP123",
            "customer_id": "cust_RZP123",
            "plan_id": "plan_growth",
            "status": "active",
            "current_end": 1800000000,
            "notes": {"account_id": str(account.id)},
        },
    )
    db.commit()

    record = db.query(Subscription).one()
    assert record.status == SubscriptionStatus.ACTIVE
    assert record.provider_customer_id == "cust_RZP123"
    assert record.provider_subscription_id == "sub_RZP123"
    # The plan is derived from the Razorpay plan id, not trusted from notes —
    # notes are editable in the dashboard.
    assert record.plan == "growth"
    assert record.clinic_limit == billing.PLANS["growth"]["clinic_limit"]


@pytest.mark.parametrize(
    ("razorpay_status", "expected", "entitled"),
    [
        ("created", SubscriptionStatus.INCOMPLETE, False),
        ("authenticated", SubscriptionStatus.TRIALING, True),
        ("active", SubscriptionStatus.ACTIVE, True),
        ("pending", SubscriptionStatus.PAST_DUE, True),
        ("halted", SubscriptionStatus.UNPAID, False),
        ("cancelled", SubscriptionStatus.CANCELED, False),
        ("completed", SubscriptionStatus.CANCELED, False),
        ("expired", SubscriptionStatus.CANCELED, False),
    ],
)
def test_every_razorpay_status_maps_to_the_right_entitlement(
    db, signed_up, razorpay_status, expected, entitled
):
    """`pending` is the one to read twice.

    Razorpay uses it for a subscription whose charge failed and is being
    retried — Stripe's `past_due`. It entitles service, because a card that
    failed this morning should not take a clinic's phone line down this
    afternoon. `halted` is where it lands once retries are exhausted, and that
    does not.
    """
    account = db.query(Account).one()
    billing.apply_subscription_state(
        db,
        {
            "id": "sub_RZP123",
            "status": razorpay_status,
            "notes": {"account_id": str(account.id)},
        },
    )
    db.commit()

    record = db.query(Subscription).one()
    assert record.status == expected
    assert record.is_entitled is entitled


def test_an_unknown_razorpay_status_does_not_silently_entitle(db, signed_up, caplog):
    """Razorpay can add a status. Guessing in either direction is worse."""
    account = db.query(Account).one()
    record = db.query(Subscription).one()
    record.status = SubscriptionStatus.CANCELED
    db.commit()

    billing.apply_subscription_state(
        db,
        {
            "id": "sub_RZP123",
            "status": "some_new_status_razorpay_invented",
            "notes": {"account_id": str(account.id)},
        },
    )
    db.commit()

    db.expire_all()
    assert db.query(Subscription).one().status == SubscriptionStatus.CANCELED


def test_a_cancellation_event_suspends_the_clinics(db, signed_up, entitled):
    account = db.query(Account).one()
    _provisioned_clinic(db, account)

    billing.handle_event(
        db,
        _subscription_event("subscription.cancelled", account.id, status="cancelled"),
        client=FakeRailway(),
    )

    db.expire_all()
    assert db.query(Clinic).one().status == ClinicStatus.SUSPENDED


def test_a_halted_subscription_suspends_the_clinics(db, signed_up, entitled):
    """Retries exhausted. This is where service actually stops."""
    account = db.query(Account).one()
    _provisioned_clinic(db, account)

    billing.handle_event(
        db,
        _subscription_event("subscription.halted", account.id, status="halted"),
        client=FakeRailway(),
    )

    db.expire_all()
    assert db.query(Clinic).one().status == ClinicStatus.SUSPENDED


def test_a_pending_subscription_does_not_suspend(db, signed_up, entitled):
    """Razorpay retries the card first; suspending on the first failure is wrong."""
    account = db.query(Account).one()
    _provisioned_clinic(db, account)

    billing.handle_event(
        db,
        _subscription_event("subscription.pending", account.id, status="pending"),
        client=FakeRailway(),
    )

    db.expire_all()
    assert db.query(Clinic).one().status == ClinicStatus.ACTIVE


def test_a_failed_payment_alone_does_not_suspend(db, signed_up, entitled):
    account = db.query(Account).one()
    _provisioned_clinic(db, account)

    billing.handle_event(
        db,
        {"event": "payment.failed", "payload": {"payment": {"entity": {"id": "pay_1"}}}},
        client=FakeRailway(),
    )

    db.expire_all()
    assert db.query(Clinic).one().status == ClinicStatus.ACTIVE


def test_resuming_brings_the_clinics_back(db, signed_up, entitled):
    """Suspension is reversible. That is the whole point of scaling to zero."""
    account = db.query(Account).one()
    clinic = _provisioned_clinic(db, account)

    fake = FakeRailway()
    billing.handle_event(
        db, _subscription_event("subscription.halted", account.id, status="halted"), client=fake
    )
    db.expire_all()
    assert db.query(Clinic).one().status == ClinicStatus.SUSPENDED

    billing.handle_event(
        db, _subscription_event("subscription.activated", account.id, status="active"), client=fake
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


# --------------------------------------------------------------------------- #
# Checkout goes to Razorpay's hosted page, not its widget
# --------------------------------------------------------------------------- #
class FakeRazorpay:
    """Records calls; returns the shape Razorpay's subscriptions API returns."""

    def __init__(self, **overrides):
        self.calls = []
        self.overrides = overrides

    def create_subscription(self, **kwargs):
        self.calls.append(("create_subscription", kwargs))
        body = {
            "id": "sub_RZP123",
            "status": "created",
            "short_url": "https://rzp.io/i/abc123",
            "plan_id": kwargs.get("plan_id"),
        }
        body.update(self.overrides)
        return body

    def cancel_subscription(self, subscription_id, **kwargs):
        self.calls.append(("cancel_subscription", {"id": subscription_id, **kwargs}))
        return {"status": "active", "current_end": 1800000000}


def test_checkout_sends_the_customer_to_razorpays_hosted_page(db, signed_up, monkeypatch):
    """Not its Checkout widget.

    The widget is a script from checkout.razorpay.com. This origin serves the
    sign-in form and reveals escrowed encryption keys, and the UI has no
    third-party requests anywhere else — taking a payment is not a good reason
    to put another party inside that boundary.
    """
    monkeypatch.setattr("app.config.settings.razorpay_plan_id_starter", "plan_starter")
    account = db.query(Account).one()
    fake = FakeRazorpay()

    result = billing.create_checkout_session(
        db, account, plan="starter", email="owner@example.com", client=fake
    )

    assert result["checkout_url"] == "https://rzp.io/i/abc123"
    assert "razorpay.com/v1/checkout" not in result["checkout_url"]
    # The key secret must never reach the browser, and neither should the key id
    # be needed there — the hosted page carries the whole flow.
    assert "key_secret" not in result
    assert "key_id" not in result


def test_checkout_carries_the_account_id_in_notes(db, signed_up, monkeypatch):
    """The webhook has to find the account without trusting the browser."""
    monkeypatch.setattr("app.config.settings.razorpay_plan_id_starter", "plan_starter")
    account = db.query(Account).one()
    fake = FakeRazorpay()

    billing.create_checkout_session(
        db, account, plan="starter", email="owner@example.com", client=fake
    )

    _, kwargs = fake.calls[0]
    assert kwargs["notes"]["account_id"] == str(account.id)


def test_checkout_delays_the_first_charge_by_the_trial(db, signed_up, monkeypatch):
    """Razorpay has no trial flag — a trial is a start date in the future."""
    monkeypatch.setattr("app.config.settings.razorpay_plan_id_starter", "plan_starter")
    monkeypatch.setattr("app.config.settings.razorpay_trial_days", 14)
    account = db.query(Account).one()
    fake = FakeRazorpay()

    billing.create_checkout_session(
        db, account, plan="starter", email="owner@example.com", client=fake
    )

    _, kwargs = fake.calls[0]
    assert kwargs["start_at"] is not None, "without start_at the card is charged today"


def test_checkout_without_an_authorisation_link_is_an_error(db, signed_up, monkeypatch):
    """Better than handing the UI an empty link."""
    monkeypatch.setattr("app.config.settings.razorpay_plan_id_starter", "plan_starter")
    account = db.query(Account).one()
    fake = FakeRazorpay(short_url=None)

    with pytest.raises(billing.BillingError):
        billing.create_checkout_session(
            db, account, plan="starter", email="owner@example.com", client=fake
        )


def test_an_unconfigured_plan_says_which_variable_is_missing(db, signed_up, monkeypatch):
    monkeypatch.setattr("app.config.settings.razorpay_plan_id_starter", None)
    account = db.query(Account).one()

    with pytest.raises(billing.BillingNotConfigured) as exc:
        billing.create_checkout_session(
            db, account, plan="starter", email="o@e.com", client=FakeRazorpay()
        )
    assert "RAZORPAY_PLAN_ID_STARTER" in str(exc.value)


def test_cancelling_does_not_mark_the_row_cancelled_immediately(db, signed_up, entitled):
    """The period is paid for. Suspending now would take a paid clinic offline."""
    account = db.query(Account).one()
    record = db.query(Subscription).one()
    record.provider_subscription_id = "sub_RZP123"
    record.status = SubscriptionStatus.ACTIVE
    db.commit()

    fake = FakeRazorpay()
    result = billing.cancel_subscription(db, account, client=fake)

    assert result["cancelled_at_cycle_end"] is True
    assert fake.calls[0][1]["at_cycle_end"] is True

    db.expire_all()
    still = db.query(Subscription).one()
    assert still.status == SubscriptionStatus.ACTIVE
    assert still.is_entitled, "cancelling at cycle end must not end service today"


def test_cancelling_without_a_subscription_is_refused(db, signed_up):
    account = db.query(Account).one()
    with pytest.raises(billing.BillingError):
        billing.cancel_subscription(db, account, client=FakeRazorpay())
