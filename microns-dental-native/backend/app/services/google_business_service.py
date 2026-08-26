"""Google Business Profile — reading and replying to public reviews.

Module 3 (review request & response) needs two calls: list recent reviews for
the practice's verified location, and post an owner reply once a dentist has
approved the AI-drafted text. The Business Profile APIs are not in
``googleapiclient``'s bundled discovery docs, so this talks to the documented
REST endpoints directly, authorised with the same OAuth token the rest of the
Google integration uses (the ``businessmanagement`` scope requires a
brand-verified Business Profile listing on top of the OAuth grant — see the
README's Business Profile section).

``account`` and ``location`` are resource names in the form
``accounts/{accountId}`` / ``accounts/{accountId}/locations/{locationId}`` —
find yours at https://business.google.com or via
``GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts``.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.services.google_auth_service import GoogleAuthService, get_google_auth

logger = logging.getLogger(__name__)

_REVIEWS_BASE = "https://mybusinessreviews.googleapis.com/v1"


def _retryable(exc: BaseException) -> bool:
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {429, 500, 503}


_retry = retry(
    retry=retry_if_exception(_retryable),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
    reraise=True,
)


class GoogleBusinessService:
    def __init__(self, auth: Optional[GoogleAuthService] = None) -> None:
        self.auth = auth or get_google_auth()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.auth.credentials.token}"}

    @_retry
    def get_recent_reviews(self, *, location: str, page_size: int = 20) -> list[dict[str, Any]]:
        """Most recent reviews for ``location`` (e.g. ``accounts/123/locations/456``)."""
        response = httpx.get(
            f"{_REVIEWS_BASE}/{location}/reviews",
            headers=self._headers(),
            params={"pageSize": page_size, "orderBy": "updateTime desc"},
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json().get("reviews", [])

    @_retry
    def reply_to_review(self, *, review_name: str, comment: str) -> dict[str, Any]:
        """Post (or replace) the owner reply on one review.

        ``review_name`` is the review's full resource name
        (``accounts/{a}/locations/{l}/reviews/{r}``), returned as ``name`` on
        each entry from :meth:`get_recent_reviews`.
        """
        response = httpx.put(
            f"https://mybusinessreviews.googleapis.com/v1/{review_name}/reply",
            headers=self._headers(),
            json={"comment": comment},
            timeout=15.0,
        )
        response.raise_for_status()
        logger.info("Posted Business Profile reply to %s", review_name)
        return response.json()


_service: Optional[GoogleBusinessService] = None


def get_business_service() -> GoogleBusinessService:
    global _service
    if _service is None:
        _service = GoogleBusinessService()
    return _service


__all__ = ["GoogleBusinessService", "get_business_service"]
