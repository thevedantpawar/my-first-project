"""Gmail — the dentist-approval mechanism for every AI-drafted message.

Two operations, and they are deliberately not interchangeable:

``create_draft``
    Used for anything a human must approve before it goes out: a treatment-
    plan follow-up SMS, a review response, a front-desk confirmation. The
    draft lives in the *Microns AI* service account's Gmail, never the
    dentist's personal inbox (see the HIPAA note in ``config.py``). A dentist
    approves by **forwarding or replying** to the draft (once it's been sent
    to their own inbox as a real message) — ``search_replies`` below is what
    a polling job uses to detect that approval.

``send_message``
    Used only for the two cases the spec calls out as urgent, unapproved
    sends: the emergency on-call alert and the front-desk task email. Nothing
    patient-facing is ever sent this way.
"""

from __future__ import annotations

import base64
import logging
from email.mime.text import MIMEText
from typing import Any, Optional

from googleapiclient.errors import HttpError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.services.google_auth_service import GoogleAuthService, get_google_auth

logger = logging.getLogger(__name__)


def _retryable(exc: BaseException) -> bool:
    return isinstance(exc, HttpError) and exc.resp is not None and exc.resp.status in {429, 500, 503}


_retry = retry(
    retry=retry_if_exception(_retryable),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
    reraise=True,
)


class GmailService:
    def __init__(self, auth: Optional[GoogleAuthService] = None) -> None:
        self.auth = auth or get_google_auth()

    @_retry
    def create_draft(self, *, to: str, subject: str, body: str) -> dict[str, Any]:
        message = _build_message(to=to, subject=subject, body=body)
        draft = (
            self.auth.gmail()
            .users()
            .drafts()
            .create(userId="me", body={"message": message})
            .execute()
        )
        logger.info("Created Gmail draft %s: %s", draft.get("id"), subject[:60])
        return draft

    @_retry
    def send_message(self, *, to: str, subject: str, body: str) -> dict[str, Any]:
        message = _build_message(to=to, subject=subject, body=body)
        sent = self.auth.gmail().users().messages().send(userId="me", body=message).execute()
        logger.info("Sent Gmail message %s: %s", sent.get("id"), subject[:60])
        return sent

    @_retry
    def search_replies(self, *, subject_contains: str, max_results: int = 20) -> list[dict[str, Any]]:
        """Find inbox messages whose subject carries an approval tag.

        Subjects are tagged ``[APPROVE-TP-<id>-DAY<n>]``, ``[APPROVE-REVIEW-<id>]``
        or ``[VERIFY-<id>]`` by whichever draft created them (Gmail preserves the
        subject across a forward, prefixing only ``Fwd:``/``Re:``), so a plain
        substring search on the tag is enough to find the reply. The polling
        job that calls this (see ``routers/internal.py``) then strips any
        ``Re:``/``Fwd:`` prefix and pulls the id out of what remains.
        """
        query = f'subject:"{subject_contains}" in:anywhere newer_than:30d'
        response = (
            self.auth.gmail()
            .users()
            .messages()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
        )
        messages = []
        for ref in response.get("messages", []):
            full = (
                self.auth.gmail()
                .users()
                .messages()
                .get(userId="me", id=ref["id"], format="metadata", metadataHeaders=["Subject", "From"])
                .execute()
            )
            headers = {h["name"]: h["value"] for h in full.get("payload", {}).get("headers", [])}
            messages.append(
                {
                    "id": full["id"],
                    "thread_id": full.get("threadId"),
                    "subject": headers.get("Subject", ""),
                    "from": headers.get("From", ""),
                    "snippet": full.get("snippet", ""),
                }
            )
        return messages

    @_retry
    def get_message_body(self, message_id: str) -> str:
        """Full plain-text body of a message — used to parse an insurance reply."""
        full = self.auth.gmail().users().messages().get(userId="me", id=message_id, format="full").execute()
        return _extract_plain_text(full.get("payload", {}))


def _build_message(*, to: str, subject: str, body: str) -> dict[str, Any]:
    mime = MIMEText(body)
    mime["to"] = to
    mime["subject"] = subject
    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode()
    return {"raw": raw}


def _extract_plain_text(payload: dict[str, Any]) -> str:
    mime_type = payload.get("mimeType", "")
    if mime_type == "text/plain" and payload.get("body", {}).get("data"):
        return _decode_body(payload["body"]["data"])
    for part in payload.get("parts", []) or []:
        text = _extract_plain_text(part)
        if text:
            return text
    # Fall back to whatever body exists (e.g. a lone text/html part).
    if payload.get("body", {}).get("data"):
        return _decode_body(payload["body"]["data"])
    return ""


def _decode_body(data: str) -> str:
    padded = data.replace("-", "+").replace("_", "/")
    padded += "=" * (-len(padded) % 4)
    try:
        return base64.b64decode(padded).decode("utf-8", errors="replace")
    except (ValueError, UnicodeDecodeError):
        return ""


_service: Optional[GmailService] = None


def get_gmail_service() -> GmailService:
    global _service
    if _service is None:
        _service = GmailService()
    return _service


__all__ = ["GmailService", "get_gmail_service"]
