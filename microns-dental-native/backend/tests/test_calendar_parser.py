from app.services.google_calendar_service import CalendarEventParser


def test_build_then_parse_roundtrips():
    description = CalendarEventParser.build_appointment_description(
        patient_id="p_1", patient_name="Jane Doe", phone="+15551234567", email="jane@example.com",
        service="Cleaning", provider="Dr. Smith", treatment_plan="Crown on #14", tp_scheduled=False,
        tp_value_cents=120000, insurance="Delta Dental PPO", member_id="MID123",
    )
    parsed = CalendarEventParser.parse_appointment_description(description)

    assert parsed["patient_id"] == "p_1"
    assert parsed["patient"] == "Jane Doe"
    assert parsed["phone"] == "+15551234567"
    assert parsed["email"] == "jane@example.com"
    assert parsed["service"] == "Cleaning"
    assert parsed["provider"] == "Dr. Smith"
    assert parsed["tp_scheduled"] is False
    assert parsed["tp_value_cents"] == 120000
    assert parsed["insurance"] == "Delta Dental PPO"
    assert parsed["member_id"] == "MID123"


def test_parse_handles_missing_description():
    parsed = CalendarEventParser.parse_appointment_description(None)
    assert parsed["patient_id"] is None
    assert parsed["tp_scheduled"] is None


def test_parse_verified_and_copay():
    description = "PATIENT_ID: p_1\nPATIENT: Jane\nPHONE: +15551234567\nSERVICE: Exam\nVERIFIED: YES\nCOPAY: $45.00"
    parsed = CalendarEventParser.parse_appointment_description(description)
    assert parsed["verified"] is True
    assert parsed["copay_cents"] == 4500
