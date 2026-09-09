"""Handing a clinic over, and pointing a domain at it.

The staff token is the credential a clinic's front desk signs in with, so at
some point a human has to be shown it. These tests pin the conditions on that:
owner only, never across an account boundary, audited every time, and never
leaking through the ordinary clinic responses.
"""

from __future__ import annotations

import pytest

from app.models.account import Account
from app.models.audit_event import AuditAction, AuditEvent
from app.models.clinic import Clinic
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.user import User
from app.services.provisioning import Provisioner
from tests.test_provisioning import FakeRailway


@pytest.fixture()
def built(client, db, signed_up):
    """An account with one provisioned clinic."""
    subscription = db.query(Subscription).one()
    subscription.status = SubscriptionStatus.ACTIVE
    db.commit()

    account = db.query(Account).one()
    clinic = Clinic(
        account_id=account.id, name="Glow Aesthetics", slug="glow-aesthetics", integrations={}
    )
    db.add(clinic)
    db.commit()
    Provisioner(db, clinic, client=FakeRailway()).provision()
    return clinic


# --------------------------------------------------------------------------- #
# Credentials
# --------------------------------------------------------------------------- #
def test_credentials_give_the_clinic_what_it_needs(client, built):
    response = client.get(f"/api/clinics/{built.id}/credentials")
    assert response.status_code == 200

    body = response.json()
    assert body["staff_api_token"] == built.staff_api_token
    assert body["console_url"].endswith("/console")
    assert "microns-chat.js" in body["widget_snippet"]
    assert body["clinic_name"] == "Glow Aesthetics"
    # The warning is the whole point of a deliberate reveal.
    assert "password manager" in body["warning"]


def test_credentials_are_audited_every_time(client, db, built):
    client.get(f"/api/clinics/{built.id}/credentials")
    client.get(f"/api/clinics/{built.id}/credentials")

    events = (
        db.query(AuditEvent)
        .filter(AuditEvent.action == AuditAction.CREDENTIALS_REVEALED)
        .all()
    )
    assert len(events) == 2, "each reveal leaves its own row"
    assert all(str(e.clinic_id) == str(built.id) for e in events)


def test_credentials_are_refused_before_the_clinic_is_built(client, db, signed_up):
    subscription = db.query(Subscription).one()
    subscription.status = SubscriptionStatus.ACTIVE
    account = db.query(Account).one()
    clinic = Clinic(account_id=account.id, name="Not Built", slug="not-built", integrations={})
    db.add(clinic)
    db.commit()

    response = client.get(f"/api/clinics/{clinic.id}/credentials")
    assert response.status_code == 409
    assert "not been built" in response.json()["detail"]


def test_a_non_owner_cannot_read_credentials(client, db, built):
    user = db.query(User).one()
    user.is_owner = False
    db.commit()

    assert client.get(f"/api/clinics/{built.id}/credentials").status_code == 403


def test_the_staff_token_never_appears_in_an_ordinary_clinic_response(client, built):
    """The reveal must stay a deliberate act, not a field somebody added."""
    token = built.staff_api_token

    assert token not in client.get("/api/clinics").text
    assert token not in client.get(f"/api/clinics/{built.id}").text


def test_credentials_cannot_be_read_across_an_account_boundary(client, db, built):
    """The tenant boundary holds for the most sensitive endpoint too."""
    other = {
        "account_name": "Radiance Group",
        "email": "other@radiance.example.com",
        "password": "a-sufficiently-long-password",
    }
    client.cookies.clear()
    assert client.post("/api/auth/signup", json=other).status_code == 201

    response = client.get(f"/api/clinics/{built.id}/credentials")
    assert response.status_code == 404, "another account's clinic is not found, not forbidden"


# --------------------------------------------------------------------------- #
# Rotation
# --------------------------------------------------------------------------- #
def test_rotation_issues_a_new_token_and_pushes_it_to_the_engine(client, db, built, monkeypatch):
    fake = FakeRailway()
    monkeypatch.setattr("app.routers.clinics.RailwayClient", lambda: fake)

    old = built.staff_api_token
    response = client.post(f"/api/clinics/{built.id}/rotate-staff-token")
    assert response.status_code == 200

    new = response.json()["staff_api_token"]
    assert new != old

    # The engine was told, and told the new value rather than the old one.
    pushed = [kw for name, kw in fake.calls if name == "set_variables"]
    assert pushed and pushed[-1]["variables"]["STAFF_API_TOKEN"] == new

    db.expire_all()
    assert db.query(Clinic).one().staff_api_token == new


def test_rotation_does_not_record_a_token_the_engine_never_received(client, db, built, monkeypatch):
    """The failure that matters is the two disagreeing.

    If Railway rejects the change, this database must not claim a token the
    clinic's engine has never heard of — that locks the clinic out with no
    indication why.
    """
    from app.services.railway import RailwayError

    class Failing(FakeRailway):
        def set_variables(self, *args, **kwargs):
            raise RailwayError("simulated rejection")

    monkeypatch.setattr("app.routers.clinics.RailwayClient", lambda: Failing())
    old = built.staff_api_token

    response = client.post(f"/api/clinics/{built.id}/rotate-staff-token")
    assert response.status_code == 502

    db.expire_all()
    assert db.query(Clinic).one().staff_api_token == old, "the stored token must not have moved"


def test_a_non_owner_cannot_rotate(client, db, built):
    user = db.query(User).one()
    user.is_owner = False
    db.commit()

    assert client.post(f"/api/clinics/{built.id}/rotate-staff-token").status_code == 403


# --------------------------------------------------------------------------- #
# Custom domains
# --------------------------------------------------------------------------- #
def test_attaching_a_domain_returns_the_dns_records(client, db, built, monkeypatch):
    class WithDomain(FakeRailway):
        def create_custom_domain(self, project_id, environment_id, service_id, domain,
                                 target_port=8000):
            self._record("create_custom_domain", domain=domain)
            return {
                "id": "cd-1",
                "domain": domain,
                "status": {
                    "verificationToken": "verify-me-123",
                    "dnsRecords": [
                        {
                            "hostlabel": "care",
                            "requiredValue": "abc.up.railway.app",
                            "status": "PENDING",
                        }
                    ],
                },
            }

    fake = WithDomain()
    monkeypatch.setattr("app.routers.clinics.RailwayClient", lambda: fake)

    response = client.post(
        f"/api/clinics/{built.id}/domain", json={"domain": "care.glowaesthetics.com"}
    )
    assert response.status_code == 200
    body = response.json()

    kinds = {r["type"] for r in body["records"]}
    assert kinds == {"CNAME", "TXT"}, (
        "both records are required — without the TXT the domain never verifies"
    )
    assert any(r["value"] == "verify-me-123" for r in body["records"])
    assert "not optional" in body["note"]


def test_attaching_a_domain_tells_the_engine_to_accept_it(client, db, built, monkeypatch):
    """In production the engine checks the Host header, so it has to be told."""

    class WithDomain(FakeRailway):
        def create_custom_domain(self, project_id, environment_id, service_id, domain,
                                 target_port=8000):
            self._record("create_custom_domain", domain=domain)
            return {"id": "cd-1", "domain": domain, "status": {"dnsRecords": []}}

    fake = WithDomain()
    monkeypatch.setattr("app.routers.clinics.RailwayClient", lambda: fake)

    client.post(f"/api/clinics/{built.id}/domain", json={"domain": "care.glowaesthetics.com"})

    pushed = [kw for name, kw in fake.calls if name == "set_variables"][-1]["variables"]
    assert "care.glowaesthetics.com" in pushed["ALLOWED_HOSTS"]
    # The generated hostname keeps working — moving a bookmark is not a flag day.
    assert "railway.app" in pushed["ALLOWED_HOSTS"]
    assert pushed["PUBLIC_BASE_URL"] == "https://care.glowaesthetics.com"


def test_the_domain_becomes_the_address_everyone_is_given(client, db, built, monkeypatch):
    class WithDomain(FakeRailway):
        def create_custom_domain(self, *a, **kw):
            return {"id": "cd-1", "domain": "care.glowaesthetics.com",
                    "status": {"dnsRecords": []}}

    monkeypatch.setattr("app.routers.clinics.RailwayClient", lambda: WithDomain())
    client.post(f"/api/clinics/{built.id}/domain", json={"domain": "care.glowaesthetics.com"})

    body = client.get(f"/api/clinics/{built.id}").json()
    assert body["public_url"] == "https://care.glowaesthetics.com"
    assert body["console_url"] == "https://care.glowaesthetics.com/console"
    assert body["widget_url"] == "https://care.glowaesthetics.com/widget/microns-chat.js"
    # And the credentials handed to the clinic use it too.
    creds = client.get(f"/api/clinics/{built.id}/credentials").json()
    assert creds["console_url"].startswith("https://care.glowaesthetics.com")


@pytest.mark.parametrize(
    "bad",
    ["not a domain", "https://has.a/path", "nodots", "has space.com"],
)
def test_a_malformed_domain_is_rejected(client, built, bad, monkeypatch):
    monkeypatch.setattr("app.routers.clinics.RailwayClient", lambda: FakeRailway())
    response = client.post(f"/api/clinics/{built.id}/domain", json={"domain": bad})
    assert response.status_code in (400, 422)


def test_a_domain_with_a_scheme_is_accepted_and_normalised(client, db, built, monkeypatch):
    """People paste URLs. Taking the hostname out is kinder than refusing."""

    class WithDomain(FakeRailway):
        def create_custom_domain(self, project_id, environment_id, service_id, domain,
                                 target_port=8000):
            self._record("create_custom_domain", domain=domain)
            return {"id": "cd-1", "domain": domain, "status": {"dnsRecords": []}}

    fake = WithDomain()
    monkeypatch.setattr("app.routers.clinics.RailwayClient", lambda: fake)

    response = client.post(
        f"/api/clinics/{built.id}/domain", json={"domain": "HTTPS://Care.GlowAesthetics.com"}
    )
    assert response.status_code == 200
    assert response.json()["domain"] == "care.glowaesthetics.com"


def test_a_domain_cannot_be_attached_before_the_engine_exists(client, db, signed_up, monkeypatch):
    subscription = db.query(Subscription).one()
    subscription.status = SubscriptionStatus.ACTIVE
    account = db.query(Account).one()
    clinic = Clinic(account_id=account.id, name="Not Built", slug="not-built", integrations={})
    db.add(clinic)
    db.commit()

    monkeypatch.setattr("app.routers.clinics.RailwayClient", lambda: FakeRailway())
    response = client.post(f"/api/clinics/{clinic.id}/domain", json={"domain": "a.example.com"})
    assert response.status_code == 409
