"""Google People API (Contacts) — caller lookup and the Prospects group.

Used two ways:

* **Lookup** (emergency capture): a missed call's caller ID is matched against
  the practice's Contacts to decide "existing patient" vs. "unknown caller"
  before anything is texted.
* **Write** (lead qualification): a HOT lead is added as a contact tagged
  ``Prospects`` so front-desk staff see new leads show up on their phone the
  same way an existing patient would.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from googleapiclient.errors import HttpError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.services.google_auth_service import GoogleAuthService, get_google_auth

logger = logging.getLogger(__name__)

_PERSON_FIELDS = "names,emailAddresses,phoneNumbers,memberships"


def _retryable(exc: BaseException) -> bool:
    return isinstance(exc, HttpError) and exc.resp is not None and exc.resp.status in {429, 500, 503}


_retry = retry(
    retry=retry_if_exception(_retryable),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
    reraise=True,
)


class GoogleContactsService:
    def __init__(self, auth: Optional[GoogleAuthService] = None) -> None:
        self.auth = auth or get_google_auth()

    @_retry
    def find_by_phone(self, phone: str) -> Optional[dict[str, Any]]:
        """Best-effort caller lookup.

        The People API's ``otherContacts.search``/``people.searchContacts``
        endpoints match on a warmed, eventually-consistent index keyed
        primarily off name and email; matching purely on phone digits is
        unreliable across formats, so this fetches the connections list and
        compares normalised digits locally. Fine at practice scale (a few
        thousand contacts); paginate further if a practice's contact list
        grows past a few pages.
        """
        target = _digits(phone)
        if not target:
            return None
        page_token = None
        for _ in range(20):  # hard cap: ~20 pages is generous for a single practice
            response = (
                self.auth.people()
                .people()
                .connections()
                .list(
                    resourceName="people/me",
                    personFields=_PERSON_FIELDS,
                    pageSize=200,
                    pageToken=page_token,
                )
                .execute()
            )
            for person in response.get("connections", []):
                for phone_entry in person.get("phoneNumbers", []):
                    if _digits(phone_entry.get("value", "")) == target:
                        return person
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return None

    @_retry
    def find_by_email(self, email: str) -> Optional[dict[str, Any]]:
        response = (
            self.auth.people()
            .people()
            .searchContacts(query=email, readMask=_PERSON_FIELDS)
            .execute()
        )
        results = response.get("results", [])
        return results[0]["person"] if results else None

    @_retry
    def add_prospect(
        self, *, given_name: str, family_name: Optional[str], phone: Optional[str], email: Optional[str]
    ) -> dict[str, Any]:
        """Create a contact tagged for the practice's 'Prospects' group."""
        body: dict[str, Any] = {"names": [{"givenName": given_name, "familyName": family_name or ""}]}
        if phone:
            body["phoneNumbers"] = [{"value": phone, "type": "mobile"}]
        if email:
            body["emailAddresses"] = [{"value": email}]
        group_id = self._ensure_group("Prospects")
        if group_id:
            body["memberships"] = [{"contactGroupMembership": {"contactGroupId": group_id}}]
        person = (
            self.auth.people()
            .people()
            .createContact(personFields=_PERSON_FIELDS, body=body)
            .execute()
        )
        return person

    @_retry
    def _ensure_group(self, name: str) -> Optional[str]:
        try:
            groups = self.auth.people().contactGroups().list(pageSize=200).execute()
            for group in groups.get("contactGroups", []):
                if group.get("formattedName", "").lower() == name.lower():
                    return group.get("resourceName")
            created = (
                self.auth.people()
                .contactGroups()
                .create(body={"contactGroup": {"name": name}})
                .execute()
            )
            return created.get("resourceName")
        except HttpError as exc:
            logger.warning("Could not ensure Contacts group %r: %s", name, exc)
            return None


def _digits(value: str) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits


_service: Optional[GoogleContactsService] = None


def get_contacts_service() -> GoogleContactsService:
    global _service
    if _service is None:
        _service = GoogleContactsService()
    return _service


__all__ = ["GoogleContactsService", "get_contacts_service"]
