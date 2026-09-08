"""Envelope encryption for the per-clinic secrets this database holds.

**What is at stake.** For each clinic the control plane stores that clinic's
``ENCRYPTION_KEY`` — the key that decrypts that clinic's PHI — along with its
staff and internal tokens. A plaintext dump of this table would be every
clinic's patient records at once.

**Why store them at all.** The alternative is that the Railway environment
variable is the only copy in existence. The engine's own documentation already
names that as the top data-loss risk: lose the variable and the PHI is
unrecoverable, permanently. Holding a wrapped copy makes re-provisioning,
disaster recovery and key rotation possible. This is a deliberate custodial
escrow, and it is why the control plane refuses to start in production without
``MASTER_KEY``.

**How.** Each value is sealed with Fernet under ``MASTER_KEY``. Rotation is
supported through ``MASTER_KEYS_OLD``: the newest key seals, and any listed key
may unseal, so a rotation does not have to rewrite every row in one
transaction.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import List, Optional

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

logger = logging.getLogger(__name__)


class SealingError(RuntimeError):
    """A value could not be sealed or unsealed."""


class SecretSealer:
    """Seals and unseals the secrets held on behalf of a clinic."""

    def __init__(self, key: Optional[str] = None, old_keys: Optional[List[str]] = None) -> None:
        key = key if key is not None else settings.master_key
        old_keys = old_keys if old_keys is not None else settings.master_keys_old

        self._ephemeral = False
        if not key:
            # Development convenience only. assert_production_ready refuses to
            # boot without a real key, so this branch cannot be reached in
            # production — and it is loud, because a restart makes every
            # previously sealed value unreadable.
            key = Fernet.generate_key().decode()
            self._ephemeral = True
            logger.warning(
                "MASTER_KEY is not set — sealing with an ephemeral key. Every "
                "secret sealed in this process becomes unreadable after restart."
            )

        try:
            self._primary = Fernet(key.encode() if isinstance(key, str) else key)
        except (ValueError, TypeError) as exc:
            raise SealingError(
                "MASTER_KEY is not a valid Fernet key. Generate one with "
                "`python -m app.cli gen-key`."
            ) from exc

        self._all: List[Fernet] = [self._primary]
        for old in old_keys or []:
            try:
                self._all.append(Fernet(old.encode() if isinstance(old, str) else old))
            except (ValueError, TypeError):
                logger.warning("Ignoring an entry in MASTER_KEYS_OLD that is not a valid Fernet key")

    @property
    def is_ephemeral(self) -> bool:
        """Whether this sealer's key vanishes when the process does."""
        return self._ephemeral

    def seal(self, plaintext: Optional[str]) -> Optional[str]:
        """Seal a value under the current primary key."""
        if plaintext is None:
            return None
        if not isinstance(plaintext, str):
            plaintext = str(plaintext)
        return self._primary.encrypt(plaintext.encode()).decode()

    def unseal(self, ciphertext: Optional[str]) -> Optional[str]:
        """Unseal a value, trying the primary key and then each retired key.

        Raises rather than returning None on failure: a secret that silently
        reads as empty would be written into a clinic's environment as an empty
        string, and the engine would boot with no encryption key at all.
        """
        if ciphertext is None:
            return None
        for fernet in self._all:
            try:
                return fernet.decrypt(ciphertext.encode()).decode()
            except InvalidToken:
                continue
        raise SealingError(
            "A stored secret could not be unsealed with MASTER_KEY or any key in "
            "MASTER_KEYS_OLD. If MASTER_KEY was rotated, add the previous key to "
            "MASTER_KEYS_OLD."
        )

    def needs_resealing(self, ciphertext: Optional[str]) -> bool:
        """Whether a value is sealed under a retired key and should be rewritten."""
        if ciphertext is None:
            return False
        try:
            self._primary.decrypt(ciphertext.encode())
            return False
        except InvalidToken:
            return True


@lru_cache
def get_sealer() -> SecretSealer:
    return SecretSealer()


def reset_sealer() -> None:
    """Drop the cached sealer. Used by the tests when they change keys."""
    get_sealer.cache_clear()


__all__ = ["SecretSealer", "SealingError", "get_sealer", "reset_sealer"]
