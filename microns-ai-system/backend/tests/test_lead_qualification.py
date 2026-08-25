"""Lead scoring, routing and the qualification conversation."""

from __future__ import annotations

import pytest

from app.models.lead import Lead, LeadStatus, LeadTemperature
from app.services.lead_service import LeadService


def make_lead(db, **fields) -> Lead:
    lead = Lead(session_id=fields.pop("session_id", "sess-1"), conversation_state={}, score_breakdown={})
    for key, value in fields.items():
        setattr(lead, key, value)
    db.add(lead)
    db.flush()
    return lead


@pytest.fixture
def service(db) -> LeadService:
    return LeadService(db)


# --------------------------------------------------------------------- #
# Scoring
# --------------------------------------------------------------------- #
def test_perfect_lead_scores_100(db, service):
    lead = make_lead(
        db,
        treatment_interest="botox",
        previous_experience=True,
        is_pregnant=False,
        blood_thinner=False,
        budget_range="2000+",
        timeline="asap",
    )
    score, breakdown, temperature = service.score_lead(lead)
    assert score == 100
    assert temperature == LeadTemperature.HOT
    assert breakdown == {
        "treatment_interest": 15,
        "previous_experience": 15,
        "budget_range": 35,
        "timeline": 35,
    }


def test_browsing_low_budget_lead_is_cold(db, service):
    lead = make_lead(
        db,
        treatment_interest="other",
        previous_experience=False,
        is_pregnant=False,
        blood_thinner=False,
        budget_range="0-500",
        timeline="browsing",
    )
    score, _, temperature = service.score_lead(lead)
    assert score == 31
    assert temperature == LeadTemperature.COLD


def test_mid_lead_is_warm(db, service):
    lead = make_lead(
        db,
        treatment_interest="fillers",
        previous_experience=False,
        is_pregnant=False,
        blood_thinner=False,
        budget_range="500-1000",
        timeline="1-2_weeks",
    )
    score, _, temperature = service.score_lead(lead)
    assert score == 71
    assert temperature == LeadTemperature.WARM


def test_pregnancy_overrides_every_other_signal(db, service):
    """A perfect lead who is pregnant must not be routed to auto-booking."""
    lead = make_lead(
        db,
        treatment_interest="botox",
        previous_experience=True,
        is_pregnant=True,
        blood_thinner=False,
        budget_range="2000+",
        timeline="asap",
    )
    score, breakdown, temperature = service.score_lead(lead)
    assert score == 0
    assert temperature == LeadTemperature.COLD
    assert breakdown["disqualified"] == "pregnant_or_breastfeeding"

    result = service.qualify(lead, notify=False)
    assert result["status"] == LeadStatus.DISQUALIFIED
    assert result["next_action"] == "medical_callback"
    assert result["medical_callback_required"] is True


def test_blood_thinner_flags_without_penalising(db, service):
    fields = dict(
        treatment_interest="botox",
        previous_experience=True,
        is_pregnant=False,
        budget_range="2000+",
        timeline="asap",
    )
    clean = make_lead(db, session_id="clean", blood_thinner=False, **fields)
    flagged = make_lead(db, session_id="flagged", blood_thinner=True, **fields)

    assert service.score_lead(clean)[0] == service.score_lead(flagged)[0]
    result = service.qualify(flagged, notify=False)
    assert result["needs_provider_approval"] is True
    assert result["score"] == 100


def test_partial_answers_score_low_and_stay_unqualified(db, service):
    lead = make_lead(db, treatment_interest="botox")
    score, _, temperature = service.score_lead(lead)
    assert score == 15
    assert temperature == LeadTemperature.COLD


def test_hot_lead_is_auto_booked(db, service):
    lead = make_lead(
        db,
        treatment_interest="botox",
        previous_experience=True,
        is_pregnant=False,
        blood_thinner=False,
        budget_range="2000+",
        timeline="asap",
    )
    lead.set_phone("+15557654321")
    db.flush()

    result = service.qualify(lead, notify=False)
    assert result["status"] == LeadStatus.BOOKED

    from app.models.appointment import Appointment

    appointment = db.query(Appointment).one()
    assert appointment.service == "consultation"
    assert appointment.extra["auto_booked"] is True


def test_warm_lead_waits_for_staff(db, service):
    lead = make_lead(
        db,
        treatment_interest="fillers",
        previous_experience=False,
        is_pregnant=False,
        blood_thinner=False,
        budget_range="500-1000",
        timeline="1-2_weeks",
    )
    lead.set_phone("+15557654322")
    db.flush()
    result = service.qualify(lead, notify=False)
    assert result["status"] == LeadStatus.QUALIFIED
    assert result["next_action"] == "staff_followup_24h"

    from app.models.appointment import Appointment

    assert db.query(Appointment).count() == 0, "warm leads are not auto-booked"


def test_cold_lead_enters_nurture(db, service):
    lead = make_lead(
        db,
        treatment_interest="other",
        previous_experience=False,
        is_pregnant=False,
        blood_thinner=False,
        budget_range="0-500",
        timeline="browsing",
    )
    result = service.qualify(lead, notify=False)
    assert result["status"] == LeadStatus.NURTURE
    assert result["next_action"] == "educational_nurture"


# --------------------------------------------------------------------- #
# Answer interpretation (no LLM available in tests — rules only)
# --------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "key,answer,expected",
    [
        ("treatment_interest", "Botox", "botox"),
        ("treatment_interest", "i want lip filler", "fillers"),
        ("treatment_interest", "laser hair removal please", "laser"),
        ("previous_experience", "yep", True),
        ("previous_experience", "no, first time", False),
        ("is_pregnant", "Yes", True),
        ("blood_thinner", "not sure", True),
        ("budget_range", "$1000-2000", "1000-2000"),
        ("budget_range", "around 1500", "1000-2000"),
        ("budget_range", "maybe 300 dollars", "0-500"),
        ("timeline", "asap", "asap"),
        ("timeline", "just browsing for now", "browsing"),
        ("timeline", "in a couple of weeks", "1-2_weeks"),
    ],
)
def test_answers_are_parsed_without_an_llm(db, service, key, answer, expected):
    from app.services.lead_service import QUESTION_BY_KEY

    value, _ = service._interpret(QUESTION_BY_KEY[key], answer, answer, make_lead(db))
    assert value == expected


def test_unparseable_answer_returns_none_rather_than_guessing(db, service):
    from app.services.lead_service import QUESTION_BY_KEY

    value, _ = service._interpret(QUESTION_BY_KEY["is_pregnant"], "hmm", "hmm", make_lead(db))
    assert value is None


def test_not_sure_about_blood_thinners_is_treated_as_yes(db, service):
    """An unverified 'maybe' on anticoagulants is a provider decision."""
    from app.services.lead_service import QUESTION_BY_KEY

    value, _ = service._interpret(QUESTION_BY_KEY["blood_thinner"], "I'm not sure", "x", make_lead(db))
    assert value is True


# --------------------------------------------------------------------- #
# Conversation
# --------------------------------------------------------------------- #
def test_full_chat_conversation_qualifies_and_books(client):
    opening = client.post("/leads/chat", json={"message": "hi"}).json()
    session_id = opening["session_id"]
    assert opening["asking"] == "treatment_interest"
    assert "Botox" in opening["options"]

    answers = ["botox", "yes", "no", "no", "2000+", "asap", "555-867-5309"]
    reply = None
    for answer in answers:
        reply = client.post(
            "/leads/chat", json={"message": answer, "session_id": session_id}
        ).json()

    assert reply["complete"] is True
    assert reply["score"] == 100
    assert reply["status"] in {"booked", "qualified"}


def test_pregnancy_answer_ends_the_conversation_immediately(client):
    opening = client.post("/leads/chat", json={"message": "hi"}).json()
    session_id = opening["session_id"]

    client.post("/leads/chat", json={"message": "botox", "session_id": session_id})
    client.post("/leads/chat", json={"message": "no", "session_id": session_id})
    reply = client.post("/leads/chat", json={"message": "yes", "session_id": session_id}).json()

    assert reply["complete"] is True
    assert reply["status"] == "disqualified"
    assert "provider" in reply["reply"].lower()
    assert reply["score"] == 0


def test_medical_question_triggers_a_callback_promise(client):
    opening = client.post("/leads/chat", json={"message": "hi"}).json()
    session_id = opening["session_id"]

    reply = client.post(
        "/leads/chat",
        json={"message": "is botox safe with my blood pressure medication?", "session_id": session_id},
    ).json()

    assert "2 hours" in reply["reply"]
    assert reply["complete"] is False
    assert reply["asking"] == "treatment_interest", "the script resumes after the handoff"


def test_conversation_resumes_across_requests(client, db):
    opening = client.post("/leads/chat", json={"message": "hi"}).json()
    session_id = opening["session_id"]
    client.post("/leads/chat", json={"message": "fillers", "session_id": session_id})

    lead = db.query(Lead).filter(Lead.session_id == session_id).one()
    assert lead.treatment_interest == "fillers"
    assert lead.conversation_state["asking"] == "previous_experience"


def test_direct_qualification_endpoint(client):
    response = client.post(
        "/leads/qualify",
        json={
            "treatment_interest": "botox",
            "previous_experience": True,
            "is_pregnant": False,
            "blood_thinner": True,
            "budget_range": "1000-2000",
            "timeline": "1-2_weeks",
            "phone": "+15551119999",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["score"] == 86
    assert body["temperature"] == "hot"
    assert body["needs_provider_approval"] is True


def test_lead_view_is_deidentified(client, staff_headers):
    created = client.post(
        "/leads/qualify",
        json={
            "name": "Jane Doe",
            "phone": "+15551234567",
            "treatment_interest": "facial",
            "previous_experience": False,
            "is_pregnant": False,
            "blood_thinner": False,
            "budget_range": "0-500",
            "timeline": "browsing",
        },
    ).json()

    response = client.get(f"/leads/{created['lead_id']}", headers=staff_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] == "Jane D."
    assert body["masked_phone"] == "***-***-4567"
    assert "5551234567" not in response.text
    assert "Jane Doe" not in response.text
