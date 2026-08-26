from app.services.deidentify import DeidentificationContext, contains_identifiers, deidentify


def test_deidentify_reidentify_roundtrip():
    ctx = DeidentificationContext(patient_uuid="abc")
    ctx.register_name("Jane Doe")
    safe = ctx.deidentify("Hi, this is Jane Doe, call me at 555-123-4567 or jane@example.com")
    assert "Jane Doe" not in safe
    assert "555-123-4567" not in safe
    assert "jane@example.com" not in safe
    assert "[PATIENT_1]" in safe

    restored = ctx.reidentify(f"Thanks, {list(ctx.tokens)[0]}!")
    assert "Jane Doe" in restored


def test_volunteered_name_is_tokenised():
    ctx = DeidentificationContext()
    safe = ctx.deidentify("my name is Alex Rivera and I have a toothache")
    assert "Alex Rivera" not in safe
    assert "[PATIENT_1]" in safe


def test_contains_identifiers_catches_phone_and_email():
    assert "PHONE" in contains_identifiers("call 555-123-4567")
    assert "EMAIL" in contains_identifiers("email jane@example.com")
    assert contains_identifiers("no identifiers here") == []


def test_one_shot_helper():
    safe, ctx = deidentify("Jane Doe called about her crown", names=["Jane Doe"])
    assert "Jane Doe" not in safe
    assert ctx.reidentify(safe) == "Jane Doe called about her crown"
