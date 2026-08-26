from app.models.lead import Lead, LeadStatus, LeadTemperature
from app.services.lead_service import LeadService


def _answered_lead(db, **overrides) -> Lead:
    lead = Lead(session_id="test-session", conversation_state={}, score_breakdown={})
    lead.set_phone("+15559998888")
    defaults = dict(
        treatment_interest="cleaning", last_visit="within_6_months", insurance_type="ppo",
        pain_level="none", timeline="browsing",
    )
    defaults.update(overrides)
    for key, value in defaults.items():
        setattr(lead, key, value)
    db.add(lead)
    db.flush()
    return lead


def test_severe_pain_is_always_hot_and_flags_escalation(db):
    lead = _answered_lead(db, pain_level="severe", timeline="browsing")
    service = LeadService(db)
    score, breakdown, temperature = service.score_lead(lead)
    assert temperature == LeadTemperature.HOT


def test_urgent_timeline_scores_hot(db):
    lead = _answered_lead(db, treatment_interest="implants", timeline="today", pain_level="moderate")
    service = LeadService(db)
    score, breakdown, temperature = service.score_lead(lead)
    assert score >= 80
    assert temperature == LeadTemperature.HOT


def test_browsing_no_pain_scores_cold(db):
    lead = _answered_lead(db, treatment_interest="whitening", timeline="browsing", pain_level="none", insurance_type="none")
    service = LeadService(db)
    score, breakdown, temperature = service.score_lead(lead)
    assert temperature == LeadTemperature.COLD


def test_qualify_sets_status_and_escalation_flag(db):
    lead = _answered_lead(db, pain_level="severe")
    result = LeadService(db).qualify(lead, notify=False)
    assert lead.needs_emergency_escalation is True
    assert result["next_action"] == "emergency_escalation"
    assert result["status"] == LeadStatus.QUALIFIED


def test_qualify_cold_lead_starts_nurture(db):
    lead = _answered_lead(db, treatment_interest="whitening", timeline="browsing", pain_level="none", insurance_type="none")
    result = LeadService(db).qualify(lead, notify=False)
    assert result["status"] == LeadStatus.NURTURE
    assert lead.conversation_state.get("nurture_step") == 1


def test_conversation_asks_questions_in_order(db):
    service = LeadService(db)
    greeting = service.greeting()
    assert greeting["asking"] == "treatment_interest"

    lead = service.get_or_create_by_session("chat-session-1")
    lead.conversation_state = {"asking": "treatment_interest"}
    db.commit()

    reply = service._advance(lead, message="Cleaning", channel="chat")
    assert reply["asking"] == "last_visit"
