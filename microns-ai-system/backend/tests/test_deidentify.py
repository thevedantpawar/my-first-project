"""De-identification: nothing identifying may reach a third-party model."""

from __future__ import annotations

import pytest

from app.services.deidentify import (
    DeidentificationContext,
    contains_identifiers,
    deidentify,
    scrub,
)


@pytest.mark.parametrize(
    "text,identifier",
    [
        ("Call me at (555) 123-4567", "555"),
        ("Call me at 555-123-4567", "123-4567"),
        ("Reach me on +1 555 123 4567", "555"),
        ("email jane.doe+spa@example.co.uk", "example.co.uk"),
        ("SSN 123-45-6789", "123-45-6789"),
        ("MRN: AB12345", "AB12345"),
    ],
)
def test_structured_identifiers_are_removed(text, identifier):
    safe, _ = deidentify(text)
    assert identifier not in safe


def test_registered_name_is_tokenised_and_restored():
    safe, context = deidentify("Jane Doe asked about Botox", names=["Jane Doe"])
    assert "Jane" not in safe
    assert "[PATIENT_1]" in safe
    assert "Botox" in safe, "clinical context the model needs must survive"
    assert context.reidentify(safe) == "Jane Doe asked about Botox"


def test_email_is_not_shredded_by_the_name_pass():
    """Ordering regression: names must not be substituted inside an email."""
    safe, _ = deidentify("jane@example.com is my email", names=["Jane"])
    assert "@example.com" not in safe
    assert "[EMAIL_1]" in safe


def test_volunteered_name_is_caught():
    safe, context = deidentify("Hi, my name is Maria Chen and I want filler")
    assert "Maria" not in safe
    assert "filler" in safe
    assert context.reidentify(safe) == "Hi, my name is Maria Chen and I want filler"


def test_lowercase_volunteered_name_is_caught():
    safe, _ = deidentify("my name is bob smith and i want botox")
    assert "bob" not in safe
    assert "botox" in safe


def test_common_phrases_are_not_mistaken_for_names():
    """'call me at 3pm' must not tokenise 'at' as a patient name."""
    safe, context = deidentify("Please call me back tomorrow at 3pm")
    assert safe == "Please call me back tomorrow at 3pm"
    assert context.token_count() == 0


def test_tokens_are_stable_within_a_context():
    context = DeidentificationContext()
    first = context.deidentify("Reach Jane Doe on 555-123-4567")
    context.register_name("Jane Doe")
    second = context.deidentify("Jane Doe again on 555-123-4567")
    assert "[PHONE_1]" in first and "[PHONE_1]" in second
    assert first.count("[PHONE_1]") == 1


def test_distinct_values_get_distinct_tokens():
    safe, _ = deidentify("Call 555-123-4567 or 555-987-6543")
    assert "[PHONE_1]" in safe and "[PHONE_2]" in safe


def test_roundtrip_is_lossless():
    original = "Hi, my name is Jane Doe, call me at (555) 123-4567 or jane@example.com"
    safe, context = deidentify(original, names=["Jane Doe"])
    assert context.reidentify(safe) == original


def test_contains_identifiers_is_the_outbound_tripwire():
    assert contains_identifiers("call 555-123-4567") == ["PHONE"]
    assert contains_identifiers("email jane@example.com") == ["EMAIL"]
    assert contains_identifiers("[PATIENT_1] wants Botox on [PHONE_1]") == []
    assert contains_identifiers("") == []


def test_scrub_is_irreversible_and_safe_for_logs():
    scrubbed = scrub("Jane Doe, 555-123-4567, jane@example.com")
    assert "555" not in scrubbed
    assert "@example.com" not in scrubbed


def test_deidentified_output_passes_the_llm_guard():
    """The two halves must agree: whatever deidentify() emits, the guard accepts."""
    from app.services.llm import LLMService

    safe, _ = deidentify(
        "I'm Jane Doe, 555-123-4567, jane@example.com — is Botox ok?", names=["Jane Doe"]
    )
    LLMService._assert_deidentified(safe)  # must not raise
