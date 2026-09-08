"""Password hashing and policy.

Argon2id, at OWASP's parameters. The hash string carries the parameters it was
made with, so raising the cost settings later does not invalidate anything —
``verify`` reports when a hash was made under weaker settings and the caller
re-hashes it during that login, while the plaintext is still in hand.

Timing is the other concern. ``verify_dummy`` exists so that signing in with an
address that has no account costs the same as signing in with one that does;
otherwise the response time tells an attacker which addresses are registered.
"""

from __future__ import annotations

import logging
import secrets
from typing import Optional, Tuple

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import settings

logger = logging.getLogger(__name__)


def _hasher() -> PasswordHasher:
    return PasswordHasher(
        time_cost=settings.argon2_time_cost,
        memory_cost=settings.argon2_memory_cost_kib,
        parallelism=settings.argon2_parallelism,
    )


#: A hash of a value nobody knows, verified against when no user matches, so
#: the failure path does the same work as the success path.
_DUMMY_HASH = _hasher().hash(secrets.token_urlsafe(32))


class PasswordPolicyError(ValueError):
    """A password that does not meet policy. The message is shown to the user."""


def validate(password: str) -> None:
    """Check a password against policy, raising with a usable message.

    Length is the requirement that actually correlates with strength, so it is
    the requirement enforced. Composition rules ("one uppercase, one symbol")
    push people towards ``Password1!`` and are not imposed.
    """
    if not password or len(password) < settings.password_min_length:
        raise PasswordPolicyError(
            f"Password must be at least {settings.password_min_length} characters."
        )
    if len(password) > 1024:
        # Argon2 will hash anything, but an unbounded input is free CPU for
        # whoever sends it.
        raise PasswordPolicyError("Password must be at most 1024 characters.")


def hash_password(password: str) -> str:
    """Validate against policy, then hash."""
    validate(password)
    return _hasher().hash(password)


def verify(password: str, password_hash: Optional[str]) -> Tuple[bool, Optional[str]]:
    """Check a password.

    Returns ``(ok, new_hash)``. ``new_hash`` is set only when the stored hash
    was made under weaker parameters than are now configured, in which case the
    caller should persist it.

    Passing ``None`` for the hash — no such user — still performs a real
    verification against a dummy, so the two paths cost the same.
    """
    hasher = _hasher()
    if not password_hash:
        verify_dummy(password)
        return False, None

    try:
        hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, None

    if hasher.check_needs_rehash(password_hash):
        return True, hasher.hash(password)
    return True, None


def verify_dummy(password: str) -> None:
    """Burn the same CPU a real verification would.

    Called when no user matches the submitted address, so that response time
    does not distinguish a registered address from an unregistered one.
    """
    try:
        _hasher().verify(_DUMMY_HASH, password or "")
    except Exception:  # noqa: BLE001 - the mismatch is the expected outcome
        pass


__all__ = ["hash_password", "verify", "verify_dummy", "validate", "PasswordPolicyError"]
