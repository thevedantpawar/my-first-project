"""Encryption, fingerprinting and at-rest guarantees."""

from __future__ import annotations

import sqlite3

import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.models.patient import Patient
from app.services.encryption import EncryptionService, get_encryption_service, normalise_identifier


def test_encrypt_decrypt_roundtrip():
    service = get_encryption_service()
    for value in ["Jane Doe", "+15551234567", "jane@example.com", "a" * 500, "émoji 🌿 name"]:
        assert service.decrypt(service.encrypt(value)) == value


def test_encrypt_is_non_deterministic():
    """Two encryptions of the same value must not be byte-identical.

    Deterministic ciphertext would let anyone with table access confirm that
    two patients share a phone number without decrypting anything.
    """
    service = get_encryption_service()
    assert service.encrypt("+15551234567") != service.encrypt("+15551234567")


def test_empty_values_pass_through():
    service = get_encryption_service()
    assert service.encrypt(None) is None
    assert service.encrypt("") is None
    assert service.decrypt(None) is None


def test_fingerprint_is_deterministic_and_normalised():
    service = get_encryption_service()
    variants = ["+15551234567", "555-123-4567", "(555) 123-4567", "5551234567"]
    fingerprints = {service.fingerprint(value) for value in variants}
    assert len(fingerprints) == 1, "phone formats that mean the same number must collide"
    assert service.fingerprint("+15559999999") not in fingerprints


def test_fingerprint_is_not_reversible():
    service = get_encryption_service()
    fingerprint = service.fingerprint("+15551234567")
    assert fingerprint is not None
    assert "5551234567" not in fingerprint
    assert len(fingerprint) == 64  # sha256 hex


def test_email_normalisation_is_case_insensitive():
    service = get_encryption_service()
    assert service.fingerprint("Jane@Example.com") == service.fingerprint("jane@example.com")


def test_normalise_identifier_handles_both_shapes():
    assert normalise_identifier("(555) 123-4567") == "+15551234567"
    assert normalise_identifier("+1 555 123 4567") == "+15551234567"
    assert normalise_identifier("Jane@Example.COM") == "jane@example.com"


def test_phi_is_ciphertext_at_rest(db, patient):
    """The strongest claim this system makes, asserted against the raw file."""
    assert settings.is_sqlite, "this assertion reads the sqlite file directly"
    path = settings.sqlalchemy_url.split("///")[-1]

    connection = sqlite3.connect(path)
    try:
        row = connection.execute(
            "SELECT encrypted_name, encrypted_phone, encrypted_email FROM patients WHERE id = ?",
            (str(patient.id),),
        ).fetchone()
    finally:
        connection.close()

    assert row is not None
    blob = " ".join(part or "" for part in row)
    assert "Jane" not in blob
    assert "Doe" not in blob
    assert "5551234567" not in blob
    assert "jane@example.com" not in blob
    assert blob.startswith("gAAAAA"), "expected Fernet tokens"


def test_orm_decrypts_transparently(db, patient):
    fetched = db.get(Patient, patient.id)
    assert fetched.name == "Jane Doe"
    assert fetched.phone == "+15551234567"
    assert fetched.email == "jane@example.com"


def test_key_rotation_reads_old_ciphertext():
    """A retired key in ENCRYPTION_KEYS_OLD must still decrypt."""
    old_key = Fernet.generate_key().decode()
    new_key = Fernet.generate_key().decode()

    old_service = EncryptionService(key=old_key, old_keys=[], fingerprint_secret="s")
    ciphertext = old_service.encrypt("Jane Doe")

    rotated = EncryptionService(key=new_key, old_keys=[old_key], fingerprint_secret="s")
    assert rotated.decrypt(ciphertext) == "Jane Doe"
    # ...and new writes use the new key, which the old service cannot read.
    with pytest.raises(InvalidToken):
        old_service.decrypt(rotated.encrypt("Jane Doe"))


def test_unknown_key_cannot_decrypt():
    stranger = EncryptionService(key=Fernet.generate_key().decode(), old_keys=[], fingerprint_secret="s")
    ciphertext = get_encryption_service().encrypt("Jane Doe")
    with pytest.raises(InvalidToken):
        stranger.decrypt(ciphertext)


def test_invalid_key_is_rejected_with_a_useful_message():
    with pytest.raises(ValueError, match="not a valid Fernet key"):
        EncryptionService(key="generate-with-fernet-key-gen", old_keys=[], fingerprint_secret="s")


def test_treatment_history_roundtrip(db, patient):
    patient.append_treatment({"service": "botox", "date": "2026-01-01"})
    patient.append_treatment({"service": "facial", "date": "2026-02-01"})
    db.commit()

    fetched = db.get(Patient, patient.id)
    assert [entry["service"] for entry in fetched.treatment_history] == ["botox", "facial"]


def test_repr_contains_no_phi(patient):
    assert "Jane" not in repr(patient)
    assert "5551234567" not in repr(patient)
