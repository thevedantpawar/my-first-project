"""The HIPAA audit trail: complete, and free of PHI."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.services.hipaa_audit import HIPAAAuditLogger


def test_log_access_writes_a_row(db, patient):
    audit = HIPAAAuditLogger(db)
    audit.log_access("read", str(patient.id), "appointment", "front-desk")
    db.commit()

    row = db.execute(select(AuditLog)).scalars().one()
    assert row.action == "read"
    assert row.patient_uuid == str(patient.id)
    assert row.data_category == "appointment"
    assert row.user_id == "front-desk"
    assert row.outcome == "success"


def test_subject_hash_correlates_without_identifying(db, patient):
    audit = HIPAAAuditLogger(db)
    audit.log_access("read", str(patient.id), "name")
    audit.log_access("write", str(patient.id), "phone")
    db.commit()

    hashes = {row.subject_hash for row in db.execute(select(AuditLog)).scalars()}
    assert len(hashes) == 1, "the same patient must produce the same hash"
    assert str(patient.id) not in hashes.pop()


def test_phi_shaped_details_are_stripped(db, patient):
    audit = HIPAAAuditLogger(db)
    audit.log_access(
        "sms_sent",
        str(patient.id),
        "phone",
        details={"phone": "+15551234567", "body": "Hi Jane", "template": "reminder_24h"},
    )
    db.commit()

    row = db.execute(select(AuditLog)).scalars().one()
    assert row.details["template"] == "reminder_24h"
    assert "phone" not in row.details
    assert "body" not in row.details
    assert row.details["phone_redacted"] is True


def test_model_rejects_phi_keys_that_bypass_the_helper(db):
    """Defence in depth: the model refuses PHI keys even on a direct insert."""
    with pytest.raises(ValueError, match="PHI-shaped keys"):
        AuditLog(action="read", data_category="name", details={"name": "Jane Doe"})


def test_long_values_are_truncated(db, patient):
    audit = HIPAAAuditLogger(db)
    audit.log_access("read", str(patient.id), "transcript", details={"note": "x" * 500})
    db.commit()
    row = db.execute(select(AuditLog)).scalars().one()
    assert len(row.details["note"]) < 250
    assert row.details["note"].endswith("[truncated]")


def test_llm_request_records_the_deidentification_claim(db, patient):
    audit = HIPAAAuditLogger(db)
    audit.log_llm_request(str(patient.id), purpose="lead_scoring", model="gpt-4o-mini", deidentified=True)
    db.commit()

    row = db.execute(select(AuditLog)).scalars().one()
    assert row.action == "llm_request"
    assert row.details["deidentified"] is True
    assert row.details["vendor"] == "openai"
    assert row.details["model"] == "gpt-4o-mini"


def test_denied_access_is_recorded(db):
    audit = HIPAAAuditLogger(db)
    audit.log_denied(reason="invalid_internal_token", ip_address="203.0.113.9")
    db.commit()

    row = db.execute(select(AuditLog)).scalars().one()
    assert row.outcome == "denied"
    assert row.details["reason"] == "invalid_internal_token"
    assert row.ip_address == "203.0.113.9"


def test_audit_works_without_a_session():
    """Used by auth failures, which have no request-scoped session yet."""
    assert HIPAAAuditLogger(None).log_access("read", None, "contact") is None


def test_stdout_trail_is_emitted_even_without_a_db(caplog):
    import logging

    with caplog.at_level(logging.INFO, logger="microns.audit"):
        HIPAAAuditLogger(None).log_access("read", "abc", "appointment")
    assert any("AUDIT:" in record.getMessage() for record in caplog.records)


def test_sms_send_is_audited_end_to_end(db, patient):
    """Every SMS must leave an audit row even when Twilio is not configured."""
    from app.services.sms_service import SMSService

    result = SMSService(db).send(
        to=patient.phone, body="Hi", template="reminder_24h", patient_uuid=str(patient.id)
    )
    db.commit()

    assert result.status == "recorded"
    row = db.execute(select(AuditLog).where(AuditLog.action == "sms_sent")).scalars().one()
    assert row.details["template"] == "reminder_24h"
