"""Signed session cookies.

A signed cookie rather than a server-side session table, because the only thing
a session needs to carry is "which user, issued when, under which epoch" — and
that fits in a cookie that the server can verify without a round trip.

Three properties matter:

* **Signed, not encrypted.** The contents are not secret; what matters is that
  they cannot be forged. ``itsdangerous`` signs with ``SESSION_SECRET``.
* **Expiring.** The signature carries a timestamp and is rejected past
  ``SESSION_MAX_AGE_SECONDS``, so a stolen cookie has a bounded life.
* **Revocable.** Each session names the ``session_epoch`` its user had when it
  was issued. Changing a password bumps the epoch, which invalidates every
  cookie already in circulation — the thing a plain signed cookie cannot
  normally do.
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import settings

logger = logging.getLogger(__name__)

#: Namespaces the signature, so a token minted for another purpose under the
#: same secret cannot be replayed as a session.
# Deliberately still says "control-plane": this is a signing salt, not a label.
# Changing it invalidates every session cookie in existence, so it does not get
# to follow a rename. The version suffix is how it would change, if it ever
# needed to.
_SALT = "microns.control-plane.session.v1"


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt=_SALT)


def issue(user_id: str, session_epoch: str) -> str:
    """Mint a session token for a user."""
    return _serializer().dumps({"uid": str(user_id), "epoch": str(session_epoch)})


def read(token: Optional[str]) -> Optional[Tuple[str, str]]:
    """Return ``(user_id, session_epoch)`` from a token, or None.

    None covers every failure — missing, malformed, forged, expired — because
    the caller's response is the same in all of them, and distinguishing them
    to the client would say more than it should.
    """
    if not token:
        return None
    try:
        payload = _serializer().loads(token, max_age=settings.session_max_age_seconds)
    except SignatureExpired:
        return None
    except BadSignature:
        logger.warning("Rejected a session cookie with a bad signature")
        return None
    except Exception:  # noqa: BLE001 - malformed payloads are just invalid
        return None

    uid = payload.get("uid") if isinstance(payload, dict) else None
    epoch = payload.get("epoch") if isinstance(payload, dict) else None
    if not uid or not epoch:
        return None
    return str(uid), str(epoch)


def cookie_kwargs() -> dict:
    """Cookie flags for ``set_cookie``.

    ``secure`` follows the environment so local development over HTTP still
    works; ``samesite=lax`` keeps the cookie off cross-site POSTs while leaving
    ordinary inbound links working.
    """
    return {
        "key": settings.session_cookie_name,
        "httponly": True,
        "secure": settings.is_production,
        "samesite": "lax",
        "max_age": settings.session_max_age_seconds,
        "path": "/",
    }


__all__ = ["issue", "read", "cookie_kwargs"]
