"""Application-level encryption for PHI.

Every PHI field in this system is encrypted *before* it reaches PostgreSQL, so
a stolen dump, a leaked replica or a careless backup contains nothing but
ciphertext. Fernet gives AES-128-CBC for confidentiality plus HMAC-SHA256 for
integrity, with a random IV per message.

Random IVs mean ``encrypt("+15551234567")`` produces different ciphertext every
time, which is exactly what you want for confidentiality and exactly what makes
``WHERE encrypted_phone = ...`` impossible. :meth:`EncryptionService.fingerprint`
solves that with a keyed HMAC: deterministic, one-way, and useless to an
attacker who does not also hold ``FINGERPRINT_SECRET``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import settings

logger = logging.getLogger(__name__)


class EncryptionService:
    """Encrypt/decrypt PHI and derive deterministic lookup fingerprints.

    ``ENCRYPTION_KEY`` is the active key. ``ENCRYPTION_KEYS_OLD`` holds retired
    keys that can still decrypt, which makes key rotation a two-deploy
    operation with no downtime:

    1. Move the current key into ``ENCRYPTION_KEYS_OLD``, set a fresh
       ``ENCRYPTION_KEY``, deploy. New writes use the new key, old rows still
       read.
    2. Run ``python -m app.cli rotate-phi`` to re-encrypt at rest, then drop the
       retired key.
    """

    def __init__(
        self,
        key: Optional[str] = None,
        old_keys: Optional[list[str]] = None,
        fingerprint_secret: Optional[str] = None,
    ) -> None:
        key = key if key is not None else settings.encryption_key
        old_keys = old_keys if old_keys is not None else settings.encryption_keys_old
        self._fingerprint_secret = (
            fingerprint_secret if fingerprint_secret is not None else settings.fingerprint_secret
        ).encode()

        if not key:
            if settings.is_production:
                raise ValueError(
                    "ENCRYPTION_KEY not set. Generate one with `python -m app.cli gen-key`."
                )
            # Development convenience only: the app boots with a throwaway key
            # so `docker compose up` works on a fresh clone. Anything written
            # with it is unreadable after a restart, which is loud enough to
            # notice and harmless because it is not real PHI.
            key = Fernet.generate_key().decode()
            self.ephemeral = True
            logger.warning(
                "ENCRYPTION_KEY not set — using an EPHEMERAL key. "
                "Encrypted data will not survive a restart."
            )
        else:
            self.ephemeral = False

        self.key = key
        primaries = [self._build_fernet(key, "ENCRYPTION_KEY")]
        for index, old in enumerate(old_keys or []):
            primaries.append(self._build_fernet(old, f"ENCRYPTION_KEYS_OLD[{index}]"))
        self.cipher = MultiFernet(primaries)

    @staticmethod
    def _build_fernet(key: str, label: str) -> Fernet:
        try:
            return Fernet(key.encode() if isinstance(key, str) else key)
        except (ValueError, TypeError) as exc:
            raise ValueError(
                f"{label} is not a valid Fernet key (32 url-safe base64 bytes). "
                "Generate one with `python -m app.cli gen-key`."
            ) from exc

    # ------------------------------------------------------------------ #
    # Core operations
    # ------------------------------------------------------------------ #
    def encrypt(self, plaintext: Optional[str]) -> Optional[str]:
        if plaintext is None or plaintext == "":
            return None
        return self.cipher.encrypt(str(plaintext).encode()).decode()

    def decrypt(self, ciphertext: Optional[str]) -> Optional[str]:
        if ciphertext is None or ciphertext == "":
            return None
        try:
            return self.cipher.decrypt(ciphertext.encode()).decode()
        except InvalidToken:
            # Never echo the ciphertext into the logs — it is still PHI.
            logger.error(
                "PHI decryption failed: token is not valid under any configured key. "
                "Check ENCRYPTION_KEY / ENCRYPTION_KEYS_OLD."
            )
            raise

    # ------------------------------------------------------------------ #
    # Deterministic helpers
    # ------------------------------------------------------------------ #
    def fingerprint(self, value: Optional[str]) -> Optional[str]:
        """Keyed, deterministic, one-way index value for an identifier.

        Used for ``WHERE phone_fingerprint = :fp`` lookups. Values are
        normalised first so ``(555) 123-4567`` and ``+15551234567`` collide the
        way a human would expect.
        """
        if not value:
            return None
        normalised = normalise_identifier(value)
        return hmac.new(self._fingerprint_secret, normalised.encode(), hashlib.sha256).hexdigest()

    def pseudonymise(self, value: Optional[str]) -> Optional[str]:
        """Hash used in audit records so a patient can be correlated but not read."""
        if not value:
            return None
        digest = hmac.new(self._fingerprint_secret, str(value).encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).decode().rstrip("=")[:32]

    @staticmethod
    def generate_key() -> str:
        return Fernet.generate_key().decode()


def normalise_identifier(value: str) -> str:
    """Normalise a phone number or email for fingerprinting.

    Phone-ish input is reduced to digits and defaulted to +1 (US med spas);
    anything else is lowercased and stripped.
    """
    value = str(value).strip()
    digits = "".join(char for char in value if char.isdigit())
    looks_like_phone = "@" not in value and len(digits) >= 7
    if looks_like_phone:
        if len(digits) == 10:
            digits = "1" + digits
        return "+" + digits
    return value.lower()


_service: Optional[EncryptionService] = None


def get_encryption_service() -> EncryptionService:
    """Process-wide singleton. Built lazily so imports never require a key."""
    global _service
    if _service is None:
        _service = EncryptionService()
    return _service


def reset_encryption_service() -> None:
    """Drop the cached singleton. Used by tests and by key rotation."""
    global _service
    _service = None


__all__ = [
    "EncryptionService",
    "get_encryption_service",
    "reset_encryption_service",
    "normalise_identifier",
]

if __name__ == "__main__":  # pragma: no cover - convenience entrypoint
    print(os.environ.get("ENCRYPTION_KEY") or EncryptionService.generate_key())
