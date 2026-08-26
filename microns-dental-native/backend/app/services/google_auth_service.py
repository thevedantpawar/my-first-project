"""Google OAuth 2.0 authentication and token refresh.

One authorised identity — the "Microns AI" service account/user — backs every
Google API call this system makes. It is deliberately **not** the dentist's
personal Google account: HIPAA §164.312(a)(1) wants access scoped to what a
role needs, and a shared automation identity is what makes the audit trail
(``hipaa_audit.py``) mean something.

``credentials.json`` is the OAuth *client* (downloaded once from Google Cloud
Console); ``token.json`` is the *authorization* for that client to act as the
Microns AI user, obtained once via :meth:`run_interactive_flow` (wraps
``python -m app.cli google-auth``) and refreshed automatically after that.
Losing ``token.json`` is not a HIPAA incident — it means re-running the OAuth
flow — but it should still live in the same secrets store as
``ENCRYPTION_KEY``, since together they're what a restore needs.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import Resource, build

from app.config import settings

logger = logging.getLogger(__name__)

#: Least-privilege scopes for the six modules — no scope is requested that a
#: module does not actually use.
SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/drive.file",
]


class GoogleAuthNotConfigured(RuntimeError):
    """Raised when a Google API is called before the OAuth flow has run."""


class GoogleAuthService:
    """Loads, refreshes and hands out Google API service clients.

    A process-wide instance is normal — see :func:`get_google_auth`. Building
    additional instances (e.g. in a test with a different token path) is also
    fine; nothing here is a true global except the cache in ``get_service``.
    """

    def __init__(
        self,
        credentials_path: Optional[str] = None,
        token_path: Optional[str] = None,
    ) -> None:
        self.credentials_path = credentials_path or settings.google_credentials_path
        self.token_path = token_path or settings.google_token_path
        self._creds: Optional[Credentials] = None
        self._services: dict[str, Resource] = {}
        # RLock, not Lock: get_service() holds this lock while evaluating
        # `self.credentials` as a call argument to build(), and that property
        # acquires the same lock — a plain Lock would deadlock a thread
        # against itself on the very first call.
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ #
    # Credential lifecycle
    # ------------------------------------------------------------------ #
    @property
    def credentials(self) -> Credentials:
        with self._lock:
            if self._creds is None:
                self._creds = self._load_credentials()
            if not self._creds.valid:
                self._refresh(self._creds)
            return self._creds

    def _load_credentials(self) -> Credentials:
        if not os.path.exists(self.token_path):
            raise GoogleAuthNotConfigured(
                f"No Google OAuth token at {self.token_path}. Run "
                "`docker compose run --rm backend python -m app.cli google-auth` once "
                "(see README) to authorise the Microns AI Google identity."
            )
        creds = Credentials.from_authorized_user_file(self.token_path, SCOPES)
        if not creds.valid:
            self._refresh(creds)
        return creds

    def _refresh(self, creds: Credentials) -> None:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open(self.token_path, "w", encoding="utf-8") as handle:
                handle.write(creds.to_json())
            logger.info("Refreshed Google OAuth token")
        elif not creds.valid:
            raise GoogleAuthNotConfigured(
                "Google OAuth token is invalid and has no refresh token. Re-run "
                "`python -m app.cli google-auth`."
            )

    def run_interactive_flow(self) -> Credentials:
        """One-time interactive consent. Writes ``token.json``.

        Needs a browser reachable from wherever this runs. On a headless
        server, run it on a laptop against the same ``credentials.json`` and
        copy the resulting ``token.json`` up — the refresh token keeps working
        wherever the file lives.
        """
        if not os.path.exists(self.credentials_path):
            raise FileNotFoundError(
                f"Google OAuth client secret not found at {self.credentials_path}. "
                "Download it from Google Cloud Console -> APIs & Services -> Credentials "
                "(see README's Google Cloud setup section)."
            )
        flow = InstalledAppFlow.from_client_secrets_file(self.credentials_path, SCOPES)
        creds = flow.run_local_server(port=0)
        with open(self.token_path, "w", encoding="utf-8") as handle:
            handle.write(creds.to_json())
        self._creds = creds
        return creds

    # ------------------------------------------------------------------ #
    # Service clients
    # ------------------------------------------------------------------ #
    def get_service(self, service_name: str, version: str) -> Resource:
        key = f"{service_name}_{version}"
        with self._lock:
            if key not in self._services:
                self._services[key] = build(
                    service_name, version, credentials=self.credentials, cache_discovery=False
                )
            return self._services[key]

    def calendar(self) -> Resource:
        return self.get_service("calendar", "v3")

    def people(self) -> Resource:
        return self.get_service("people", "v1")

    def gmail(self) -> Resource:
        return self.get_service("gmail", "v1")

    def drive(self) -> Resource:
        return self.get_service("drive", "v3")


_instance: Optional[GoogleAuthService] = None
_instance_lock = threading.Lock()


def get_google_auth() -> GoogleAuthService:
    """Process-wide singleton, built lazily so importing this module never
    requires ``token.json`` to already exist."""
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = GoogleAuthService()
        return _instance


def reset_google_auth() -> None:
    global _instance
    with _instance_lock:
        _instance = None


__all__ = ["GoogleAuthService", "GoogleAuthNotConfigured", "get_google_auth", "reset_google_auth", "SCOPES"]
