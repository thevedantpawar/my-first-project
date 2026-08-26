"""Google Calendar: the primary trigger source for this system.

Two responsibilities live here:

``CalendarEventParser``
    A practice's front-desk/PMS software writes patient context into an
    event's *description* as ``KEY: value`` lines (see
    :func:`CalendarEventParser.build_appointment_description` for the exact
    template, and the README for how to configure your PMS/Calendly to do
    this). The parser turns that back into structured data — no PHI is ever
    encoded in an event *title*, which is what most calendar UIs show on a
    phone's lock screen.

``GoogleCalendarService``
    Thin, retrying wrapper around the Calendar API v3 for the handful of
    operations the six modules need: search for a patient's future
    appointments (hygiene recall), create/update/delete a tracking event
    (recall + treatment-plan follow-up), and read/update a real appointment
    (insurance verification, emergency booking).

Push notifications (``events.watch``) are what makes Calendar a *trigger*
rather than something merely polled. See ``routers/webhooks.py`` for the
receiving end and the README for how to register a watch channel — channels
expire (max 30 days) and must be renewed, which the README's cron example
covers.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from googleapiclient.errors import HttpError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.config import settings
from app.services.google_auth_service import GoogleAuthService, get_google_auth
from app.utils import to_practice_time, utcnow

logger = logging.getLogger(__name__)


def _retryable(exc: BaseException) -> bool:
    """Retry on Google's transient statuses; fail fast on everything else.

    A 404 (deleted event) or 403 (missing scope) will not fix itself on a
    retry, and retrying those wastes the caller's timeout budget.
    """
    return isinstance(exc, HttpError) and exc.resp is not None and exc.resp.status in {429, 500, 503}


_retry = retry(
    retry=retry_if_exception(_retryable),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
    reraise=True,
)


class CalendarEventParser:
    """Parse and build the structured ``KEY: value`` calendar event description."""

    _KEYS = (
        "PATIENT_ID",
        "PATIENT",
        "PHONE",
        "EMAIL",
        "SERVICE",
        "PROVIDER",
        "TREATMENT_PLAN",
        "TP_SCHEDULED",
        "TP_VALUE",
        "INSURANCE",
        "MEMBER_ID",
        "VERIFIED",
        "COPAY",
    )

    @classmethod
    def parse_appointment_description(cls, description: Optional[str]) -> dict[str, Any]:
        """Extract structured fields from a calendar event description.

        Returns every known key (``None`` if absent) rather than only the keys
        found, so callers can use plain attribute-style access without a
        ``KeyError``.
        """
        data: dict[str, Any] = {key.lower(): None for key in cls._KEYS}
        if not description:
            return data

        for line in description.splitlines():
            if ":" not in line:
                continue
            raw_key, _, raw_value = line.partition(":")
            key = raw_key.strip().upper()
            value = raw_value.strip()
            if key not in cls._KEYS or not value:
                continue
            data[key.lower()] = value

        if data["tp_scheduled"] is not None:
            data["tp_scheduled"] = str(data["tp_scheduled"]).strip().upper() == "YES"
        if data["tp_value"] is not None:
            data["tp_value_cents"] = _to_cents(data["tp_value"])
        else:
            data["tp_value_cents"] = None
        if data["copay"] is not None:
            data["copay_cents"] = _to_cents(data["copay"])
        else:
            data["copay_cents"] = None
        if data["verified"] is not None:
            data["verified"] = str(data["verified"]).strip().upper() in {"YES", "TRUE", "Y"}
        return data

    @staticmethod
    def build_appointment_description(
        *,
        patient_id: str,
        patient_name: str,
        phone: str,
        email: Optional[str] = None,
        service: str,
        provider: Optional[str] = None,
        treatment_plan: Optional[str] = None,
        tp_scheduled: Optional[bool] = None,
        tp_value_cents: Optional[int] = None,
        insurance: Optional[str] = None,
        member_id: Optional[str] = None,
        verified: Optional[bool] = None,
        copay_cents: Optional[int] = None,
    ) -> str:
        """Build a structured calendar event description.

        Matches :meth:`parse_appointment_description` exactly — round-tripping
        through both is what the test suite asserts on.
        """
        lines = [
            f"PATIENT_ID: {patient_id}",
            f"PATIENT: {patient_name}",
            f"PHONE: {phone}",
        ]
        if email:
            lines.append(f"EMAIL: {email}")
        lines.append(f"SERVICE: {service}")
        if provider:
            lines.append(f"PROVIDER: {provider}")
        if treatment_plan:
            lines.append(f"TREATMENT_PLAN: {treatment_plan}")
            lines.append(f"TP_SCHEDULED: {'YES' if tp_scheduled else 'NO'}")
        if tp_value_cents:
            lines.append(f"TP_VALUE: ${tp_value_cents / 100:,.2f}")
        if insurance:
            lines.append(f"INSURANCE: {insurance}")
        if member_id:
            lines.append(f"MEMBER_ID: {member_id}")
        if verified is not None:
            lines.append(f"VERIFIED: {'YES' if verified else 'NO'}")
        if copay_cents is not None:
            lines.append(f"COPAY: ${copay_cents / 100:,.2f}")
        return "\n".join(lines)


def _to_cents(value: str) -> Optional[int]:
    try:
        cleaned = str(value).replace("$", "").replace(",", "").strip()
        return round(float(cleaned) * 100)
    except (TypeError, ValueError):
        return None


class GoogleCalendarService:
    """Calendar CRUD the six modules actually need.

    Every method takes ``calendar_id`` explicitly rather than defaulting to
    one in settings — a hygiene-recall tracking event and a real appointment
    almost never live on the same calendar, and an implicit default is exactly
    how a recall event ends up cluttering the practice's real booking
    calendar.
    """

    def __init__(self, auth: Optional[GoogleAuthService] = None) -> None:
        self.auth = auth or get_google_auth()

    @_retry
    def get_event(self, calendar_id: str, event_id: str) -> Optional[dict[str, Any]]:
        try:
            return self.auth.calendar().events().get(calendarId=calendar_id, eventId=event_id).execute()
        except HttpError as exc:
            if exc.resp.status == 404:
                return None
            raise

    @_retry
    def search_future_events(
        self,
        calendar_id: str,
        *,
        query: Optional[str] = None,
        time_min: Optional[datetime] = None,
        time_max: Optional[datetime] = None,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """List upcoming events, optionally full-text filtered.

        Used by the hygiene-recall check ("does this patient already have a
        future visit?") and by the insurance-verification job ("tomorrow's new
        patient appointments"). ``query`` is Calendar's full-text search — it
        matches the description, so searching by email/phone works as long as
        :meth:`CalendarEventParser.build_appointment_description` wrote it.
        """
        params: dict[str, Any] = {
            "calendarId": calendar_id,
            "timeMin": (time_min or utcnow()).isoformat() + "Z",
            "singleEvents": True,
            "orderBy": "startTime",
            "maxResults": max_results,
        }
        if time_max is not None:
            params["timeMax"] = time_max.isoformat() + "Z"
        if query:
            params["q"] = query
        response = self.auth.calendar().events().list(**params).execute()
        return response.get("items", [])

    @_retry
    def create_event(
        self,
        calendar_id: str,
        *,
        summary: str,
        description: str,
        start: datetime,
        end: datetime,
        reminders_minutes: Optional[list[int]] = None,
        color_id: Optional[str] = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "summary": summary,
            "description": description,
            "start": {"dateTime": _iso(start), "timeZone": "UTC"},
            "end": {"dateTime": _iso(end), "timeZone": "UTC"},
        }
        if reminders_minutes:
            body["reminders"] = {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": m} for m in reminders_minutes],
            }
        if color_id:
            body["colorId"] = color_id
        event = self.auth.calendar().events().insert(calendarId=calendar_id, body=body).execute()
        logger.info("Created calendar event %s on %s", event.get("id"), calendar_id)
        return event

    @_retry
    def update_event(
        self,
        calendar_id: str,
        event_id: str,
        *,
        description: Optional[str] = None,
        summary: Optional[str] = None,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
    ) -> Optional[dict[str, Any]]:
        body: dict[str, Any] = {}
        if description is not None:
            body["description"] = description
        if summary is not None:
            body["summary"] = summary
        if start is not None:
            body["start"] = {"dateTime": _iso(start), "timeZone": "UTC"}
        if end is not None:
            body["end"] = {"dateTime": _iso(end), "timeZone": "UTC"}
        if not body:
            return self.get_event(calendar_id, event_id)
        try:
            return (
                self.auth.calendar()
                .events()
                .patch(calendarId=calendar_id, eventId=event_id, body=body)
                .execute()
            )
        except HttpError as exc:
            if exc.resp.status == 404:
                logger.warning("Tried to update missing calendar event %s", event_id)
                return None
            raise

    @_retry
    def delete_event(self, calendar_id: str, event_id: str) -> bool:
        try:
            self.auth.calendar().events().delete(calendarId=calendar_id, eventId=event_id).execute()
            return True
        except HttpError as exc:
            if exc.resp.status in {404, 410}:
                return True  # already gone — deletion is idempotent
            raise

    def watch(self, calendar_id: str, *, channel_id: str, webhook_url: str, ttl_hours: int = 24 * 7) -> dict[str, Any]:
        """Register a push-notification channel (the ``event ended`` trigger).

        Google delivers only a ping (no event data) to ``webhook_url`` on any
        change; the receiver (see ``routers/webhooks.py``) re-queries the
        calendar for what actually changed. Channels expire — the README's
        renewal cron re-calls this before ``expiration`` passes.
        """
        expiration_ms = int((utcnow() + timedelta(hours=ttl_hours)).timestamp() * 1000)
        body = {
            "id": channel_id,
            "type": "web_hook",
            "address": webhook_url,
            "expiration": str(expiration_ms),
        }
        return self.auth.calendar().events().watch(calendarId=calendar_id, body=body).execute()


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        return value.isoformat() + "Z"
    return value.isoformat()


def practice_hours_label(value: datetime) -> str:
    """Small convenience used by a couple of services for log-friendly output."""
    local = to_practice_time(value)
    return local.strftime("%Y-%m-%d %H:%M %Z")


__all__ = ["CalendarEventParser", "GoogleCalendarService", "practice_hours_label"]
