"""The owner console's read API.

Two things are being protected here. The first is access: every route is
staff-only and returns no unmasked identifier. The second is honesty — the
revenue projection must never imply it knows a price that was never recorded,
and the opportunity feed must never surface an item the engine has already
handled.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.models.appointment import Appointment, AppointmentSource, AppointmentStatus
from app.models.lead import Lead, LeadStatus, LeadTemperature
from app.models.patient import Patient
from app.models.voice_call import VoiceCall, VoiceCallOutcome
from app.utils import utcnow

CONSOLE_ROUTES = [
    "/console/api/session",
    "/console/api/overview",
    "/console/api/opportunities",
    "/console/api/leads",
    "/console/api/conversations",
    "/console/api/revenue",
    "/console/api/agents",
    "/console/api/workflows",
    "/console/api/insights",
    "/console/api/system",
]


# --------------------------------------------------------------------- #
# Access control
# --------------------------------------------------------------------- #
@pytest.mark.parametrize("route", CONSOLE_ROUTES)
def test_console_routes_require_a_staff_token(client, route):
    assert client.get(route).status_code == 401


@pytest.mark.parametrize("route", CONSOLE_ROUTES)
def test_console_routes_reject_a_wrong_token(client, route):
    assert client.get(route, headers={"X-Staff-Token": "nope"}).status_code == 401


@pytest.mark.parametrize("route", CONSOLE_ROUTES)
def test_console_routes_answer_a_staff_token(client, staff_headers, route):
    assert client.get(route, headers=staff_headers).status_code == 200


def test_a_denied_console_read_is_audited(client, db):
    from app.models.audit_log import AuditLog

    client.get("/console/api/overview", headers={"X-Staff-Token": "wrong"})
    denied = db.query(AuditLog).filter(AuditLog.outcome == "denied").all()
    assert denied, "a rejected console read must leave an audit record"


# --------------------------------------------------------------------- #
# PHI containment
# --------------------------------------------------------------------- #
def test_leads_are_de_identified(client, staff_headers, db):
    lead = Lead(session_id="s1", conversation_state={}, score_breakdown={})
    lead.set_name("Jennifer Miller")
    lead.set_phone("+15551239876")
    lead.treatment_interest = "botox"
    lead.qualification_score = 90
    lead.temperature = LeadTemperature.HOT
    lead.status = LeadStatus.QUALIFIED
    db.add(lead)
    db.commit()

    body = client.get("/console/api/leads", headers=staff_headers).json()
    assert len(body) == 1
    row = body[0]

    assert row["display_name"] == "Jennifer M."
    assert "Jennifer Miller" not in str(body)
    assert "+15551239876" not in str(body)
    assert row["masked_phone"].endswith("9876")
    assert row["treatment_label"] == "Botox"


def test_a_call_transcript_is_never_returned(client, staff_headers, db, patient):
    call = VoiceCall(
        patient_id=patient.id,
        outcome=VoiceCallOutcome.FAQ,
        summary={"intent": "pricing"},
    )
    call.transcript = "Patient said she is taking warfarin"
    db.add(call)
    db.commit()

    body = client.get("/console/api/conversations", headers=staff_headers).json()
    assert "warfarin" not in str(body)
    row = next(item for item in body if item["type"] == "call")
    # The console reports that a transcript exists without exposing it.
    assert row["transcript_available"] is True


# --------------------------------------------------------------------- #
# Opportunities
# --------------------------------------------------------------------- #
def test_a_no_show_becomes_an_opportunity(client, staff_headers, db, patient):
    db.add(
        Appointment(
            patient_id=patient.id,
            service="botox",
            scheduled_for=utcnow() - timedelta(days=1),
            status=AppointmentStatus.NO_SHOW,
        )
    )
    db.commit()

    items = client.get("/console/api/opportunities", headers=staff_headers).json()
    no_shows = [item for item in items if item["kind"] == "no_show"]
    assert len(no_shows) == 1
    item = no_shows[0]
    assert item["kind_label"] == "No-show recovery"
    assert item["next_action"]
    assert item["why"]
    assert item["record"]["patient_uuid"] == str(patient.id)


def test_a_rebooked_no_show_is_not_an_opportunity(client, staff_headers, db, patient):
    """The point of the feed is what still needs doing, not what happened."""
    db.add(
        Appointment(
            patient_id=patient.id,
            service="botox",
            scheduled_for=utcnow() - timedelta(days=3),
            status=AppointmentStatus.NO_SHOW,
        )
    )
    db.add(
        Appointment(
            patient_id=patient.id,
            service="botox",
            scheduled_for=utcnow() + timedelta(days=2),
            status=AppointmentStatus.CONFIRMED,
        )
    )
    db.commit()

    items = client.get("/console/api/opportunities", headers=staff_headers).json()
    assert not [item for item in items if item["kind"] == "no_show"]


def test_a_clinical_callback_outranks_a_review_request(client, staff_headers, db, patient):
    db.add(
        VoiceCall(
            patient_id=patient.id,
            outcome=VoiceCallOutcome.CALLBACK_REQUESTED,
            created_at=utcnow() - timedelta(hours=4),
            summary={"handoff_reason": "clinical"},
        )
    )
    db.add(
        Appointment(
            patient_id=patient.id,
            service="facial",
            scheduled_for=utcnow() - timedelta(days=10),
            status=AppointmentStatus.COMPLETED,
            completed_at=utcnow() - timedelta(days=10),
        )
    )
    db.commit()

    items = client.get("/console/api/opportunities", headers=staff_headers).json()
    kinds = [item["kind"] for item in items]
    assert kinds.index("callback") < kinds.index("review")

    callback = next(item for item in items if item["kind"] == "callback")
    assert "Past the 2-hour promise" in callback["flags"]


# --------------------------------------------------------------------- #
# Revenue honesty
# --------------------------------------------------------------------- #
def test_revenue_reports_its_own_coverage(client, staff_headers, db, patient):
    """An unpriced appointment is counted, but contributes no money."""
    db.add(
        Appointment(
            patient_id=patient.id,
            service="botox",
            scheduled_for=utcnow() - timedelta(days=2),
            status=AppointmentStatus.COMPLETED,
            completed_at=utcnow() - timedelta(days=2),
            price_cents=45000,
        )
    )
    db.add(
        Appointment(
            patient_id=patient.id,
            service="facial",
            scheduled_for=utcnow() - timedelta(days=1),
            status=AppointmentStatus.COMPLETED,
            completed_at=utcnow() - timedelta(days=1),
            price_cents=None,
        )
    )
    db.commit()

    body = client.get("/console/api/revenue", headers=staff_headers).json()

    assert body["completed"]["count"] == 2
    assert body["completed"]["priced_count"] == 1
    assert body["completed"]["cents"] == 45000
    assert body["coverage"]["appointments"] == 2
    assert body["coverage"]["with_recorded_price"] == 1
    # False is what makes the console print "1 of 2 have a recorded price".
    assert body["coverage"]["complete"] is False


def test_revenue_attributes_by_recorded_source_only(client, staff_headers, db, patient):
    db.add(
        Appointment(
            patient_id=patient.id,
            service="botox",
            scheduled_for=utcnow() + timedelta(days=1),
            status=AppointmentStatus.CONFIRMED,
            source=AppointmentSource.VOICE,
        )
    )
    db.add(
        Appointment(
            patient_id=patient.id,
            service="facial",
            scheduled_for=utcnow() + timedelta(days=2),
            status=AppointmentStatus.CONFIRMED,
            source=AppointmentSource.STAFF,
        )
    )
    db.commit()

    body = client.get("/console/api/revenue", headers=staff_headers).json()
    assert body["attribution"]["ai_booked"]["count"] == 1
    assert body["attribution"]["front_desk"]["count"] == 1
    assert body["attribution"]["recovered_no_show"]["count"] == 0


def test_a_rebooking_after_recovery_is_attributed_to_recovery(client, staff_headers, db, patient):
    now = utcnow()
    db.add(
        Appointment(
            patient_id=patient.id,
            service="botox",
            scheduled_for=now - timedelta(days=10),
            status=AppointmentStatus.NO_SHOW,
            reactivation_sent_at=now - timedelta(days=9),
        )
    )
    db.commit()
    db.add(
        Appointment(
            patient_id=patient.id,
            service="botox",
            scheduled_for=now + timedelta(days=3),
            status=AppointmentStatus.CONFIRMED,
            source=AppointmentSource.SMS,
        )
    )
    db.commit()

    body = client.get("/console/api/revenue", headers=staff_headers).json()
    assert body["attribution"]["recovered_no_show"]["count"] == 1
    assert body["recovered_appointments"] == 1


# --------------------------------------------------------------------- #
# System status
# --------------------------------------------------------------------- #
def test_system_never_claims_an_unconfigured_integration(client, staff_headers):
    body = client.get("/console/api/system", headers=staff_headers).json()
    integrations = {item["id"]: item for item in body["integrations"]}

    # The test environment has no Twilio and no OpenAI credentials.
    assert integrations["sms"]["connected"] is False
    assert integrations["ai"]["connected"] is False
    assert "not connected" in integrations["sms"]["detail"].lower() or (
        "never leave" in integrations["sms"]["detail"].lower()
    )
    # It does have a VAPI secret, so the phone system is genuinely reachable.
    assert integrations["phone"]["connected"] is True


def test_agents_report_the_connection_they_actually_have(client, staff_headers):
    agents = {agent["id"]: agent for agent in client.get("/console/api/agents", headers=staff_headers).json()}
    assert agents["receptionist"]["status"] == "live"  # VAPI secret is set in tests
    assert "not delivered" in agents["recovery"]["status_detail"].lower()
    assert agents["concierge"]["advanced"]["model"] == "rule engine"


def test_workflows_do_not_guess_their_runtime_state(client, staff_headers):
    workflows = client.get("/console/api/workflows", headers=staff_headers).json()
    assert len(workflows) == 5
    assert all(workflow["runtime_state"] == "unknown" for workflow in workflows)
    assert all(workflow["steps"] for workflow in workflows)


# --------------------------------------------------------------------- #
# Lead detail
# --------------------------------------------------------------------- #
def test_lead_detail_states_that_no_transcript_is_kept(client, staff_headers, db):
    lead = Lead(
        session_id="s2",
        conversation_state={"asking": "budget_range", "turns": 3},
        score_breakdown={"budget": 20},
    )
    lead.set_name("Sam Rivera")
    lead.treatment_interest = "fillers"
    db.add(lead)
    db.commit()

    body = client.get(f"/console/api/leads/{lead.id}", headers=staff_headers).json()

    assert body["conversation"]["transcript_retained"] is False
    assert body["conversation"]["turns"] == 3
    assert body["conversation"]["currently_asking"] == "Asked about budget"
    assert body["journey"][0]["done"] is True
    assert body["score_breakdown"] == {"budget": 20}


def test_lead_detail_404s_for_an_unknown_id(client, staff_headers):
    response = client.get(
        "/console/api/leads/00000000-0000-0000-0000-000000000000", headers=staff_headers
    )
    assert response.status_code == 404


def test_a_flagged_lead_is_never_no_action_needed(client, staff_headers, db):
    """A booked lead awaiting provider sign-off still needs a human."""
    lead = Lead(session_id="s3", conversation_state={}, score_breakdown={})
    lead.set_name("Alex Stone")
    lead.status = LeadStatus.BOOKED
    lead.needs_provider_approval = True
    db.add(lead)
    db.commit()

    row = client.get("/console/api/leads", headers=staff_headers).json()[0]
    assert "no action needed" not in row["next_action"].lower()
    assert "provider approval" in row["next_action"].lower()


# --------------------------------------------------------------------- #
# Console assets
# --------------------------------------------------------------------- #
def test_the_console_page_is_served(client):
    response = client.get("/console")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_the_console_page_is_not_a_way_around_authentication(client):
    """Serving the shell is fine; serving data without a token is not."""
    assert client.get("/console").status_code == 200
    assert client.get("/console/api/overview").status_code == 401
