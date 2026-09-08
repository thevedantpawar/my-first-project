"""Generating the secrets a clinic's engine runs on.

Every clinic gets its own set. That is the point of tenant-per-deployment: two
clinics share no key, so a compromise of one is a compromise of one. Reusing a
single ``ENCRYPTION_KEY`` across clinics would quietly undo the whole isolation
argument.

Nothing here reads a secret from configuration — these are generated, sealed,
and written to exactly two places: this database (encrypted) and the clinic's
Railway environment.
"""

from __future__ import annotations

import secrets as pysecrets
from dataclasses import dataclass, field
from typing import Dict

from cryptography.fernet import Fernet

#: Length in bytes of the random tokens. 32 bytes of urlsafe base64 is 43
#: characters — comfortably beyond guessing, and short enough to paste.
TOKEN_BYTES = 32


def generate_token() -> str:
    """A URL-safe random token for a shared secret."""
    return pysecrets.token_urlsafe(TOKEN_BYTES)


def generate_encryption_key() -> str:
    """A Fernet key for the engine's PHI encryption.

    Must be a valid Fernet key, not an arbitrary random string — the engine
    passes it straight to ``Fernet()`` and would refuse to start otherwise.
    """
    return Fernet.generate_key().decode()


@dataclass
class ClinicSecrets:
    """The full set of secrets one clinic's engine needs.

    ``encryption_key`` is the one that matters: it encrypts every identifying
    field in that clinic's database. Lose it and the PHI is unrecoverable; leak
    it and the PHI is readable. It is generated here, sealed into the control
    plane's database, and set on the clinic's engine — and nowhere else.
    """

    encryption_key: str = field(default_factory=generate_encryption_key)
    fingerprint_secret: str = field(default_factory=generate_token)
    internal_api_token: str = field(default_factory=generate_token)
    staff_api_token: str = field(default_factory=generate_token)
    vapi_webhook_secret: str = field(default_factory=generate_token)

    def as_env(self) -> Dict[str, str]:
        """The environment variables these become on the engine.

        Names match ``microns-ai-system/backend/app/config.py`` exactly. A
        typo here is a clinic that boots with a default secret, which is
        precisely the failure the engine's own startup checks exist to catch —
        so ``test_provisioning`` asserts these names against the engine's
        settings model rather than trusting them.
        """
        return {
            "ENCRYPTION_KEY": self.encryption_key,
            "FINGERPRINT_SECRET": self.fingerprint_secret,
            "INTERNAL_API_TOKEN": self.internal_api_token,
            "STAFF_API_TOKEN": self.staff_api_token,
            "VAPI_WEBHOOK_SECRET": self.vapi_webhook_secret,
        }

    def __repr__(self) -> str:  # pragma: no cover - must never print a secret
        return "<ClinicSecrets (redacted)>"


#: Substrings marking a value that must never reach a log or an event row.
_SENSITIVE_HINTS = (
    "key",
    "token",
    "secret",
    "password",
    "credential",
    "authorization",
    "dsn",
    "database_url",
)


def scrub(payload):
    """Recursively redact anything that looks like a secret.

    Applied to everything written into ``ProvisioningEvent.details`` and to
    Railway's API responses before they are logged. Matching on the key name is
    blunt, and deliberately so: the cost of redacting a harmless field is a
    less useful log line, and the cost of missing one is a clinic's encryption
    key in a log aggregator.
    """
    if isinstance(payload, dict):
        cleaned = {}
        for key, value in payload.items():
            if any(hint in str(key).lower() for hint in _SENSITIVE_HINTS):
                cleaned[key] = "[redacted]"
            else:
                cleaned[key] = scrub(value)
        return cleaned
    if isinstance(payload, list):
        return [scrub(item) for item in payload]
    return payload


__all__ = [
    "ClinicSecrets",
    "generate_token",
    "generate_encryption_key",
    "scrub",
]
