from app.services.encryption import EncryptionService, normalise_identifier


def test_roundtrip():
    service = EncryptionService(key=EncryptionService.generate_key(), fingerprint_secret="s")
    ciphertext = service.encrypt("+15551234567")
    assert ciphertext != "+15551234567"
    assert service.decrypt(ciphertext) == "+15551234567"


def test_fingerprint_is_deterministic_and_normalised():
    service = EncryptionService(key=EncryptionService.generate_key(), fingerprint_secret="s")
    assert service.fingerprint("(555) 123-4567") == service.fingerprint("+15551234567")
    assert service.fingerprint("Jane@Example.com") == service.fingerprint("jane@example.com")


def test_encrypt_is_nondeterministic():
    service = EncryptionService(key=EncryptionService.generate_key(), fingerprint_secret="s")
    a = service.encrypt("+15551234567")
    b = service.encrypt("+15551234567")
    assert a != b  # random IV per call
    assert service.decrypt(a) == service.decrypt(b)


def test_normalise_identifier_phone_vs_email():
    assert normalise_identifier("(555) 123-4567") == "+15551234567"
    assert normalise_identifier("Jane@Example.com") == "jane@example.com"
