"""Signup, sign-in, and password lifecycle.

The rule running through all of it: an unauthenticated caller learns nothing
about which email addresses have accounts. Signup with a taken address, sign-in
with an unknown one, and a reset request for an address that does not exist all
behave — and cost — the same as their counterparts. An enumerable user list is
the first step of a credential-stuffing run, and for a healthcare product it
also discloses which clinics are customers.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import timedelta
from typing import Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.user import User
from app.services import passwords
from app.utils import slugify, utcnow

logger = logging.getLogger(__name__)

#: How long a password-reset link is valid. Long enough to find the email,
#: short enough that one sitting in an abandoned inbox is not a standing key.
RESET_TOKEN_TTL = timedelta(hours=1)


class SignupError(ValueError):
    """Signup could not proceed. The message is safe to show the user."""


def normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def _unique_slug(db: Session, model, base: str) -> str:
    """A slug that is not taken, with a numeric suffix if it has to be.

    Clinic slugs become part of a Railway service name, so a collision is not
    cosmetic — it is two clinics contending for one hostname.
    """
    root = slugify(base)
    candidate = root
    suffix = 2
    while db.query(model).filter(model.slug == candidate).first() is not None:
        candidate = f"{root}-{suffix}"[:60]
        suffix += 1
    return candidate


def find_user_by_email(db: Session, email: str) -> Optional[User]:
    return (
        db.query(User)
        .filter(func.lower(User.email) == normalise_email(email))
        .one_or_none()
    )


def create_account(
    db: Session,
    *,
    account_name: str,
    email: str,
    password: str,
    name: Optional[str] = None,
) -> Tuple[Account, User]:
    """Create an account, its owner, and a subscription in the 'none' state.

    The subscription row exists from the start rather than being created at
    checkout, so entitlement is a lookup that always finds a row instead of a
    null check every caller has to remember.
    """
    email = normalise_email(email)

    # Policy is checked before the uniqueness probe so a weak password is
    # reported as a weak password rather than as a taken address.
    passwords.validate(password)

    if find_user_by_email(db, email) is not None:
        raise SignupError("That email address is already registered.")

    account = Account(name=account_name.strip(), slug=_unique_slug(db, Account, account_name))
    db.add(account)
    db.flush()

    user = User(
        account_id=account.id,
        email=email,
        name=(name or "").strip() or None,
        password_hash=passwords.hash_password(password),
        is_owner=True,
        session_epoch=uuid.uuid4().hex[:16],
    )
    db.add(user)

    db.add(
        Subscription(
            account_id=account.id,
            status=SubscriptionStatus.NONE,
            plan="starter",
            clinic_limit=1,
        )
    )
    db.flush()
    return account, user


def authenticate(db: Session, *, email: str, password: str) -> Optional[User]:
    """Check credentials.

    Returns None for every failure — no such user, wrong password, deactivated
    — because the caller's response must not distinguish them. The dummy verify
    on the no-such-user path keeps the timing indistinguishable too.
    """
    user = find_user_by_email(db, email)
    if user is None:
        passwords.verify_dummy(password)
        return None

    ok, upgraded = passwords.verify(password, user.password_hash)
    if not ok:
        return None

    if not user.is_active:
        return None

    if upgraded:
        # The stored hash predates the current cost parameters, and the
        # plaintext is in hand exactly once — now.
        user.password_hash = upgraded

    user.last_login_at = utcnow()
    return user


def _hash_reset_token(token: str) -> str:
    """Store only the hash, so a database dump yields no working reset links."""
    return hashlib.sha256(token.encode()).hexdigest()


def begin_password_reset(db: Session, *, email: str) -> Optional[Tuple[User, str]]:
    """Issue a reset token, or None if the address has no account.

    The caller must respond identically either way. None means "say it was
    sent" and send nothing — it does not mean "tell them the address is
    unknown".
    """
    user = find_user_by_email(db, email)
    if user is None or not user.is_active:
        return None

    token = secrets.token_urlsafe(32)
    user.reset_token_hash = _hash_reset_token(token)
    user.reset_token_expires_at = utcnow() + RESET_TOKEN_TTL
    return user, token


def complete_password_reset(db: Session, *, token: str, new_password: str) -> Optional[User]:
    """Consume a reset token and set a new password.

    The token is single-use and time-limited, and success bumps the session
    epoch: whoever prompted the reset is signed out everywhere, which is the
    point of resetting after a suspected compromise.
    """
    if not token:
        return None

    passwords.validate(new_password)

    token_hash = _hash_reset_token(token)
    user = db.query(User).filter(User.reset_token_hash == token_hash).one_or_none()
    if user is None or not user.is_active:
        return None

    if not user.reset_token_expires_at or user.reset_token_expires_at < utcnow():
        return None

    user.password_hash = passwords.hash_password(new_password)
    user.reset_token_hash = None
    user.reset_token_expires_at = None
    user.session_epoch = uuid.uuid4().hex[:16]
    return user


def change_password(db: Session, *, user: User, current_password: str, new_password: str) -> bool:
    """Change a password for a signed-in user.

    Requires the current password even though the caller is authenticated: it
    is what stops an unattended logged-in browser becoming a permanent
    takeover.
    """
    ok, _ = passwords.verify(current_password, user.password_hash)
    if not ok:
        return False

    passwords.validate(new_password)
    user.password_hash = passwords.hash_password(new_password)
    user.session_epoch = uuid.uuid4().hex[:16]
    return True


__all__ = [
    "SignupError",
    "create_account",
    "authenticate",
    "find_user_by_email",
    "begin_password_reset",
    "complete_password_reset",
    "change_password",
    "normalise_email",
]
