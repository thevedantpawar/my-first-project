from app.services.emergency_service import _parse_keyword
from app.services.insurance_service import _fallback_parse


def test_emergency_keyword_parsing():
    assert _parse_keyword("URGENT please help") == "URGENT"
    assert _parse_keyword("book me in") == "BOOK"
    assert _parse_keyword("what are your info hours") == "INFO"
    assert _parse_keyword("random reply") == "OTHER"


def test_insurance_fallback_parse_extracts_dollars_and_flags():
    text = (
        "Annual max remaining: $1200.00. Deductible met: Y, remaining $0. "
        "Waiting periods: N. Copay: $45.00"
    )
    parsed = _fallback_parse(text)
    assert parsed["annual_max_remaining_cents"] == 120000
    assert parsed["deductible_met"] is True
    assert parsed["waiting_periods"] is False
    assert parsed["estimated_copay_cents"] == 4500


def test_insurance_fallback_parse_handles_missing_fields():
    parsed = _fallback_parse("Not much info here.")
    assert parsed["annual_max_remaining_cents"] is None
    assert parsed["deductible_met"] is False
