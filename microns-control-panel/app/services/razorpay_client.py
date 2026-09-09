"""Razorpay's REST API, over httpx.

The official SDK is a thin wrapper over the same HTTP calls, and this service
already talks to Railway's API the same way. One fewer dependency in the image
that holds the tenant secret escrow is worth the few functions below.

Razorpay authenticates with HTTP Basic: key id as the username, key secret as
the password. The secret never leaves this module.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any, Dict, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

API_ROOT = "https://api.razorpay.com/v1"
TIMEOUT = 20.0


class RazorpayError(RuntimeError):
    """Razorpay refused a request, or could not be reached."""


class RazorpayNotConfigured(RazorpayError):
    """No API credentials. Everything else still works; nothing is billed."""


class RazorpayClient:
    def __init__(self, key_id: Optional[str] = None, key_secret: Optional[str] = None) -> None:
        self.key_id = key_id or settings.razorpay_key_id
        self.key_secret = key_secret or settings.razorpay_key_secret
        if not (self.key_id and self.key_secret):
            raise RazorpayNotConfigured(
                "Razorpay is not configured — set RAZORPAY_KEY_ID and "
                "RAZORPAY_KEY_SECRET to take payments."
            )

    def _request(self, method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        url = f"{API_ROOT}{path}"
        try:
            response = httpx.request(
                method,
                url,
                auth=(self.key_id, self.key_secret),
                timeout=TIMEOUT,
                **kwargs,
            )
        except httpx.HTTPError as exc:
            raise RazorpayError(f"Could not reach Razorpay: {exc}") from exc

        if response.status_code >= 400:
            # Razorpay puts the useful part in error.description. The raw body
            # can echo request fields, so only the description is surfaced.
            detail = response.text[:200]
            try:
                detail = response.json()["error"]["description"]
            except Exception:  # noqa: BLE001 - best effort on an error path
                pass
            raise RazorpayError(f"Razorpay returned {response.status_code}: {detail}")

        try:
            return response.json()
        except ValueError as exc:
            raise RazorpayError("Razorpay returned a non-JSON body") from exc

    # -- subscriptions -------------------------------------------------- #
    def create_subscription(
        self,
        *,
        plan_id: str,
        total_count: int,
        start_at: Optional[int] = None,
        notes: Optional[Dict[str, str]] = None,
        customer_notify: bool = True,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "plan_id": plan_id,
            "total_count": total_count,
            "customer_notify": 1 if customer_notify else 0,
        }
        if start_at:
            body["start_at"] = start_at
        if notes:
            body["notes"] = notes
        return self._request("POST", "/subscriptions", json=body)

    def fetch_subscription(self, subscription_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/subscriptions/{subscription_id}")

    def cancel_subscription(
        self, subscription_id: str, *, at_cycle_end: bool = True
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/subscriptions/{subscription_id}/cancel",
            json={"cancel_at_cycle_end": 1 if at_cycle_end else 0},
        )


def verify_webhook_signature(payload: bytes, signature: Optional[str], secret: str) -> bool:
    """Whether this body was signed with the webhook secret.

    Razorpay signs the raw request body with HMAC-SHA256 and sends the hex
    digest in ``X-Razorpay-Signature``. The body has to be the bytes as
    received — re-serialising the parsed JSON changes the whitespace and the
    signature stops matching, which looks exactly like an attack.
    """
    if not signature or not secret:
        return False
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


__all__ = [
    "RazorpayClient",
    "RazorpayError",
    "RazorpayNotConfigured",
    "verify_webhook_signature",
]
