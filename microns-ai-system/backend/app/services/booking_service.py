"""Booking-system adapter.

``BOOKING_SYSTEM_TYPE`` selects the backend: ``generic`` (the built-in
PostgreSQL scheduler), ``acuity``, ``square`` or ``mindbody``. Everything above
this module — the voice agent, the appointments API, lead auto-booking — talks
to the :class:`BookingAdapter` interface and never to a vendor SDK.

The ``generic`` adapter is the default and needs no third-party account: it
derives availability from clinic hours minus what is already on the calendar.
That is what makes ``docker compose up`` produce a system that actually books
appointments on a fresh clone.

The vendor adapters are written against each provider's documented REST API and
degrade to ``generic`` when credentials are absent or the vendor call fails —
a med spa's phone line staying up matters more than a booking landing in the
right calendar on the first try, and the pending appointment is still recorded
locally for staff to reconcile.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.appointment import Appointment, AppointmentStatus
from app.utils import (
    clinic_tz,
    format_appointment_time,
    from_clinic_time,
    parse_datetime,
    to_clinic_time,
    utcnow,
)

logger = logging.getLogger(__name__)

try:  # pragma: no cover - present in the image
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore[assignment]


@dataclass
class Slot:
    """An offerable appointment slot. ``start``/``end`` are naive UTC."""

    start: datetime
    end: datetime
    provider: Optional[str] = None
    external_id: Optional[str] = None

    @property
    def label(self) -> str:
        return format_appointment_time(self.start)

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start.isoformat() + "Z",
            "end": self.end.isoformat() + "Z",
            "label": self.label,
            "provider": self.provider,
            "external_id": self.external_id,
        }


@dataclass
class BookingRef:
    external_id: Optional[str]
    confirmed: bool
    provider_name: str
    raw: dict[str, Any]


class BookingAdapter(ABC):
    name = "generic"

    def __init__(self, db: Session) -> None:
        self.db = db

    @abstractmethod
    def get_available_slots(
        self, *, service: str, days_ahead: int = 7, limit: int = 12
    ) -> list[Slot]:
        ...

    @abstractmethod
    def create_booking(
        self,
        *,
        service: str,
        start: datetime,
        patient_name: Optional[str],
        patient_phone: Optional[str],
        patient_email: Optional[str] = None,
        duration_minutes: int = 30,
    ) -> BookingRef:
        ...

    def cancel_booking(self, external_id: str) -> bool:
        return True

    def reschedule_booking(self, external_id: str, new_start: datetime) -> BookingRef:
        return BookingRef(external_id=external_id, confirmed=True, provider_name=self.name, raw={})


class InternalBookingAdapter(BookingAdapter):
    """Availability derived from clinic hours minus booked appointments."""

    name = "generic"

    def get_available_slots(self, *, service: str, days_ahead: int = 7, limit: int = 12) -> list[Slot]:
        duration = settings.appointment_slot_minutes
        taken = self._booked_windows(days_ahead)

        slots: list[Slot] = []
        # Start from the next slot boundary at least an hour out — nobody wants
        # the agent offering an appointment that starts in four minutes.
        cursor = _next_slot_boundary(utcnow() + timedelta(hours=1), duration)
        horizon = utcnow() + timedelta(days=days_ahead)

        while cursor < horizon and len(slots) < limit:
            local = to_clinic_time(cursor)
            within_hours = settings.clinic_open_hour <= local.hour < settings.clinic_close_hour
            is_weekday = local.weekday() < 6  # Mon-Sat
            end = cursor + timedelta(minutes=duration)

            if within_hours and is_weekday and not _overlaps(cursor, end, taken):
                slots.append(Slot(start=cursor, end=end, provider=None))
                cursor = end
                continue

            if not within_hours or not is_weekday:
                cursor = _next_opening(cursor)
            else:
                cursor = end

        return slots

    def _booked_windows(self, days_ahead: int) -> list[tuple[datetime, datetime]]:
        rows = (
            self.db.execute(
                select(Appointment).where(
                    Appointment.status.in_(AppointmentStatus.ACTIVE),
                    Appointment.scheduled_for >= utcnow() - timedelta(hours=4),
                    Appointment.scheduled_for <= utcnow() + timedelta(days=days_ahead + 1),
                )
            )
            .scalars()
            .all()
        )
        return [
            (row.scheduled_for, row.scheduled_for + timedelta(minutes=row.duration_minutes or 30))
            for row in rows
        ]

    def create_booking(
        self,
        *,
        service: str,
        start: datetime,
        patient_name: Optional[str],
        patient_phone: Optional[str],
        patient_email: Optional[str] = None,
        duration_minutes: int = 30,
    ) -> BookingRef:
        # The Appointment row itself is the booking; the caller writes it.
        return BookingRef(external_id=None, confirmed=True, provider_name=self.name, raw={})


class AcuityBookingAdapter(BookingAdapter):
    """Acuity Scheduling (HTTP Basic: user id + API key).

    Written against Acuity's documented v1 REST API. Verify against a sandbox
    account before go-live — appointment type ids are per-clinic.
    """

    name = "acuity"
    base_url = "https://acuityscheduling.com/api/v1"

    def __init__(self, db: Session) -> None:
        super().__init__(db)
        self._fallback = InternalBookingAdapter(db)
        self._auth = (
            (settings.booking_api_key or "", settings.booking_api_secret or "")
            if settings.booking_api_key and settings.booking_api_secret
            else None
        )

    def _get(self, path: str, params: dict[str, Any]) -> Optional[Any]:
        if not self._auth or httpx is None:
            return None
        try:
            response = httpx.get(
                f"{settings.booking_api_base_url or self.base_url}{path}",
                params=params,
                auth=self._auth,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            logger.error("Acuity GET %s failed: %s", path, type(exc).__name__)
            return None

    def get_available_slots(self, *, service: str, days_ahead: int = 7, limit: int = 12) -> list[Slot]:
        if not self._auth:
            return self._fallback.get_available_slots(service=service, days_ahead=days_ahead, limit=limit)

        slots: list[Slot] = []
        today = to_clinic_time(utcnow()).date()
        for offset in range(days_ahead):
            if len(slots) >= limit:
                break
            day = today + timedelta(days=offset)
            payload = self._get(
                "/availability/times",
                {
                    "date": day.isoformat(),
                    "appointmentTypeID": settings.booking_calendar_id,
                    "calendarID": settings.booking_calendar_id,
                },
            )
            for entry in payload or []:
                start = parse_datetime(entry.get("time"))
                if start is None:
                    continue
                slots.append(
                    Slot(
                        start=start,
                        end=start + timedelta(minutes=settings.appointment_slot_minutes),
                        provider=str(entry.get("calendar") or "") or None,
                    )
                )
                if len(slots) >= limit:
                    break

        if not slots:
            logger.warning("Acuity returned no availability; falling back to internal scheduler")
            return self._fallback.get_available_slots(service=service, days_ahead=days_ahead, limit=limit)
        return slots

    def create_booking(
        self,
        *,
        service: str,
        start: datetime,
        patient_name: Optional[str],
        patient_phone: Optional[str],
        patient_email: Optional[str] = None,
        duration_minutes: int = 30,
    ) -> BookingRef:
        if not self._auth or httpx is None:
            return self._fallback.create_booking(
                service=service,
                start=start,
                patient_name=patient_name,
                patient_phone=patient_phone,
                patient_email=patient_email,
                duration_minutes=duration_minutes,
            )
        first, _, last = (patient_name or "").partition(" ")
        try:
            response = httpx.post(
                f"{settings.booking_api_base_url or self.base_url}/appointments",
                json={
                    "datetime": to_clinic_time(start).isoformat(),
                    "appointmentTypeID": settings.booking_calendar_id,
                    "firstName": first or "Patient",
                    "lastName": last or "",
                    "phone": patient_phone,
                    "email": patient_email,
                },
                auth=self._auth,
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            return BookingRef(
                external_id=str(data.get("id")), confirmed=True, provider_name=self.name, raw=data
            )
        except Exception as exc:
            logger.error("Acuity booking failed: %s — recorded locally instead", type(exc).__name__)
            return BookingRef(external_id=None, confirmed=False, provider_name=self.name, raw={})


class SquareBookingAdapter(BookingAdapter):
    """Square Appointments (Bearer token).

    Availability comes from ``/v2/bookings/availability/search``. As with
    Acuity, verify against a sandbox account: service variation ids and team
    member ids are per-merchant.
    """

    name = "square"
    base_url = "https://connect.squareup.com"

    def __init__(self, db: Session) -> None:
        super().__init__(db)
        self._fallback = InternalBookingAdapter(db)
        self._token = settings.booking_api_key

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Square-Version": "2024-10-17",
            "Content-Type": "application/json",
        }

    def get_available_slots(self, *, service: str, days_ahead: int = 7, limit: int = 12) -> list[Slot]:
        if not self._token or httpx is None:
            return self._fallback.get_available_slots(service=service, days_ahead=days_ahead, limit=limit)
        now = utcnow()
        try:
            response = httpx.post(
                f"{settings.booking_api_base_url or self.base_url}/v2/bookings/availability/search",
                headers=self._headers,
                json={
                    "query": {
                        "filter": {
                            "start_at_range": {
                                "start_at": now.isoformat() + "Z",
                                "end_at": (now + timedelta(days=days_ahead)).isoformat() + "Z",
                            },
                            "location_id": settings.booking_calendar_id,
                        }
                    }
                },
                timeout=10.0,
            )
            response.raise_for_status()
            availabilities = response.json().get("availabilities", [])
        except Exception as exc:
            logger.error("Square availability failed: %s", type(exc).__name__)
            return self._fallback.get_available_slots(service=service, days_ahead=days_ahead, limit=limit)

        slots: list[Slot] = []
        for entry in availabilities[:limit]:
            start = parse_datetime(entry.get("start_at"))
            if start is None:
                continue
            slots.append(
                Slot(start=start, end=start + timedelta(minutes=settings.appointment_slot_minutes))
            )
        return slots or self._fallback.get_available_slots(
            service=service, days_ahead=days_ahead, limit=limit
        )

    def create_booking(
        self,
        *,
        service: str,
        start: datetime,
        patient_name: Optional[str],
        patient_phone: Optional[str],
        patient_email: Optional[str] = None,
        duration_minutes: int = 30,
    ) -> BookingRef:
        if not self._token or httpx is None:
            return self._fallback.create_booking(
                service=service,
                start=start,
                patient_name=patient_name,
                patient_phone=patient_phone,
                patient_email=patient_email,
                duration_minutes=duration_minutes,
            )
        try:
            response = httpx.post(
                f"{settings.booking_api_base_url or self.base_url}/v2/bookings",
                headers=self._headers,
                json={
                    "booking": {
                        "start_at": start.isoformat() + "Z",
                        "location_id": settings.booking_calendar_id,
                        "customer_note": service,
                    }
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json().get("booking", {})
            return BookingRef(
                external_id=str(data.get("id")), confirmed=True, provider_name=self.name, raw=data
            )
        except Exception as exc:
            logger.error("Square booking failed: %s — recorded locally instead", type(exc).__name__)
            return BookingRef(external_id=None, confirmed=False, provider_name=self.name, raw={})


class MindbodyBookingAdapter(InternalBookingAdapter):
    """Placeholder.

    Mindbody's Public API needs a per-site OAuth token exchange that cannot be
    written blind. Until that is implemented against a real site, this behaves
    exactly like the internal scheduler and says so at startup, rather than
    pretending to talk to Mindbody and silently dropping bookings.
    """

    name = "mindbody"

    def __init__(self, db: Session) -> None:
        super().__init__(db)
        logger.warning(
            "BOOKING_SYSTEM_TYPE=mindbody is not implemented; using the internal scheduler. "
            "Appointments are stored locally and must be reconciled with Mindbody."
        )


class GoogleCalendarBookingAdapter(BookingAdapter):
    """Google Calendar (OAuth 2.0 refresh token).

    Availability is the clinic's own opening hours minus everything already on
    the calendar. The engine asks Google what is busy — via ``freeBusy.query``,
    which returns opaque busy blocks and never event titles or attendees — and
    removes those windows from the slots the internal scheduler would have
    offered. Booking writes a real event, so the appointment shows up wherever
    the clinic already looks.

    **Why a refresh token rather than a service account.** A service account is
    the tidier answer for a Workspace domain, but a med spa owner's calendar is
    very often an ordinary consumer Google account, where sharing a calendar
    with a service account is fiddly and domain-wide delegation does not exist
    at all. A refresh token works identically for both, and the clinic can
    revoke it from their Google account page without involving anyone.

    Access tokens are exchanged on demand and cached until shortly before they
    expire, so a busy clinic is not re-authenticating on every call.

    Degrades to the internal scheduler whenever credentials are missing or
    Google is unreachable — the phone line staying up matters more than a
    booking landing in the right calendar on the first attempt, and the
    appointment is still recorded locally for staff to reconcile.
    """

    name = "google_calendar"
    base_url = "https://www.googleapis.com/calendar/v3"
    token_url = "https://oauth2.googleapis.com/token"

    def __init__(self, db: Session) -> None:
        super().__init__(db)
        self._fallback = InternalBookingAdapter(db)
        self._access_token: Optional[str] = None
        self._token_expires_at: Optional[datetime] = None

    # ---------------------------------------------------------------- #
    # Auth
    # ---------------------------------------------------------------- #
    @property
    def configured(self) -> bool:
        return bool(
            settings.google_oauth_client_id
            and settings.google_oauth_client_secret
            and settings.google_oauth_refresh_token
            and httpx is not None
        )

    def _token(self) -> Optional[str]:
        """A valid access token, exchanged from the refresh token if needed."""
        if not self.configured:
            return None

        now = utcnow()
        if self._access_token and self._token_expires_at and now < self._token_expires_at:
            return self._access_token

        try:
            response = httpx.post(
                self.token_url,
                data={
                    "client_id": settings.google_oauth_client_id,
                    "client_secret": settings.google_oauth_client_secret,
                    "refresh_token": settings.google_oauth_refresh_token,
                    "grant_type": "refresh_token",
                },
                timeout=10.0,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # pragma: no cover - network
            # Never log the body: a token endpoint's error response can echo
            # the client id back, and the exception type is enough to debug.
            logger.error("Google token exchange failed: %s", type(exc).__name__)
            return None

        token = payload.get("access_token")
        if not token:
            logger.error("Google token exchange returned no access_token")
            return None

        # Expire a minute early so a request never starts on a token that
        # dies mid-flight.
        lifetime = int(payload.get("expires_in", 3600))
        self._access_token = token
        self._token_expires_at = now + timedelta(seconds=max(lifetime - 60, 30))
        return token

    @property
    def _calendar_id(self) -> str:
        return settings.google_calendar_id or "primary"

    def _headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # ---------------------------------------------------------------- #
    # Availability
    # ---------------------------------------------------------------- #
    def get_available_slots(self, *, service: str, days_ahead: int = 7, limit: int = 12) -> list[Slot]:
        # The clinic's hours are the starting point either way; Google only
        # ever removes slots, never adds them.
        candidates = self._fallback.get_available_slots(
            service=service, days_ahead=days_ahead, limit=limit * 3
        )
        token = self._token()
        if not token or not candidates:
            return candidates[:limit]

        busy = self._busy_windows(token, days_ahead)
        if busy is None:
            # Could not ask. Offering the internal slots is the safe failure:
            # a double booking is visible and fixable, a phone agent with no
            # times to offer is not.
            logger.warning("Google freeBusy unavailable; offering internal slots")
            return candidates[:limit]

        free = [slot for slot in candidates if not _overlaps(slot.start, slot.end, busy)]
        return free[:limit]

    def _busy_windows(self, token: str, days_ahead: int) -> Optional[list[tuple[datetime, datetime]]]:
        """Ask Google what is already booked.

        ``freeBusy.query`` returns time ranges only — no titles, no attendees,
        no descriptions. That is deliberately the endpoint used here: the
        engine needs to know when the clinic is busy, and has no business
        reading what the appointments are.
        """
        now = utcnow()
        try:
            response = httpx.post(
                f"{self.base_url}/freeBusy",
                headers=self._headers(token),
                json={
                    "timeMin": now.isoformat() + "Z",
                    "timeMax": (now + timedelta(days=days_ahead + 1)).isoformat() + "Z",
                    "items": [{"id": self._calendar_id}],
                },
                timeout=10.0,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # pragma: no cover - network
            logger.error("Google freeBusy failed: %s", type(exc).__name__)
            return None

        calendar = (payload.get("calendars") or {}).get(self._calendar_id, {})
        if calendar.get("errors"):
            logger.error(
                "Google freeBusy rejected calendar %r — check the id and that the "
                "authorising account can see it",
                self._calendar_id,
            )
            return None

        windows: list[tuple[datetime, datetime]] = []
        for block in calendar.get("busy", []):
            start = parse_datetime(block.get("start"))
            end = parse_datetime(block.get("end"))
            if start and end:
                windows.append((start, end))
        return windows

    # ---------------------------------------------------------------- #
    # Writes
    # ---------------------------------------------------------------- #
    def create_booking(
        self,
        *,
        service: str,
        start: datetime,
        patient_name: Optional[str],
        patient_phone: Optional[str],
        patient_email: Optional[str] = None,
        duration_minutes: int = 30,
    ) -> BookingRef:
        token = self._token()
        if not token:
            return self._fallback.create_booking(
                service=service,
                start=start,
                patient_name=patient_name,
                patient_phone=patient_phone,
                patient_email=patient_email,
                duration_minutes=duration_minutes,
            )

        end = start + timedelta(minutes=duration_minutes)
        # A calendar entry is not a medical record and must not become one.
        # The title carries a first name and the service; the phone number
        # goes in the description because staff need to call people, and
        # nothing clinical is written at all.
        summary = f"{_first_name_only(patient_name) or 'Client'} — {service.replace('_', ' ').title()}"
        body: dict[str, Any] = {
            "summary": summary,
            "description": "Booked by Microns.\n"
            + (f"Contact: {patient_phone}\n" if patient_phone else ""),
            "start": {"dateTime": start.isoformat() + "Z"},
            "end": {"dateTime": end.isoformat() + "Z"},
            "extendedProperties": {"private": {"microns": "1"}},
        }

        try:
            response = httpx.post(
                f"{self.base_url}/calendars/{quote(self._calendar_id, safe='')}/events",
                headers=self._headers(token),
                json=body,
                timeout=10.0,
            )
            response.raise_for_status()
            event = response.json()
        except Exception as exc:  # pragma: no cover - network
            logger.error(
                "Google Calendar booking failed: %s — recorded locally instead", type(exc).__name__
            )
            return self._fallback.create_booking(
                service=service,
                start=start,
                patient_name=patient_name,
                patient_phone=patient_phone,
                patient_email=patient_email,
                duration_minutes=duration_minutes,
            )

        return BookingRef(
            external_id=event.get("id"),
            confirmed=True,
            provider_name=self.name,
            raw={"htmlLink": event.get("htmlLink")},
        )

    def cancel_booking(self, external_id: str) -> bool:
        token = self._token()
        if not token or not external_id:
            return False
        try:
            response = httpx.delete(
                f"{self.base_url}/calendars/{quote(self._calendar_id, safe='')}/events/{quote(external_id, safe='')}",
                headers=self._headers(token),
                timeout=10.0,
            )
            # 410 means it is already gone, which is the outcome we wanted.
            return response.status_code in (200, 204, 404, 410)
        except Exception as exc:  # pragma: no cover - network
            logger.error("Google Calendar cancel failed: %s", type(exc).__name__)
            return False

    def reschedule_booking(self, external_id: str, new_start: datetime) -> BookingRef:
        token = self._token()
        if not token or not external_id:
            return BookingRef(external_id=external_id, confirmed=False, provider_name=self.name, raw={})

        end = new_start + timedelta(minutes=settings.appointment_slot_minutes)
        try:
            response = httpx.patch(
                f"{self.base_url}/calendars/{quote(self._calendar_id, safe='')}/events/{quote(external_id, safe='')}",
                headers=self._headers(token),
                json={
                    "start": {"dateTime": new_start.isoformat() + "Z"},
                    "end": {"dateTime": end.isoformat() + "Z"},
                },
                timeout=10.0,
            )
            response.raise_for_status()
        except Exception as exc:  # pragma: no cover - network
            logger.error("Google Calendar reschedule failed: %s", type(exc).__name__)
            return BookingRef(external_id=external_id, confirmed=False, provider_name=self.name, raw={})

        return BookingRef(external_id=external_id, confirmed=True, provider_name=self.name, raw={})


def _first_name_only(name: Optional[str]) -> Optional[str]:
    """A calendar is shared and glanceable; a surname on it is a disclosure."""
    if not name:
        return None
    return name.strip().split(" ")[0]


_ADAPTERS = {
    "generic": InternalBookingAdapter,
    "internal": InternalBookingAdapter,
    "acuity": AcuityBookingAdapter,
    "square": SquareBookingAdapter,
    "mindbody": MindbodyBookingAdapter,
    "google": GoogleCalendarBookingAdapter,
    "google_calendar": GoogleCalendarBookingAdapter,
}


def get_booking_service(db: Session) -> BookingAdapter:
    adapter = _ADAPTERS.get((settings.booking_system_type or "generic").lower())
    if adapter is None:
        logger.warning(
            "Unknown BOOKING_SYSTEM_TYPE=%r; using the internal scheduler", settings.booking_system_type
        )
        adapter = InternalBookingAdapter
    return adapter(db)


# ---------------------------------------------------------------------- #
def _next_slot_boundary(moment: datetime, minutes: int) -> datetime:
    """Round up to the next :00/:30 (or whatever the slot size is)."""
    moment = moment.replace(second=0, microsecond=0)
    remainder = moment.minute % minutes
    if remainder:
        moment += timedelta(minutes=minutes - remainder)
    return moment


def _next_opening(moment: datetime) -> datetime:
    """Advance to the clinic's next opening time."""
    local = to_clinic_time(moment)
    if local.hour < settings.clinic_open_hour:
        candidate = local.replace(
            hour=settings.clinic_open_hour, minute=0, second=0, microsecond=0
        )
    else:
        candidate = (local + timedelta(days=1)).replace(
            hour=settings.clinic_open_hour, minute=0, second=0, microsecond=0
        )
    # Sunday -> Monday
    while candidate.weekday() > 5:
        candidate += timedelta(days=1)
    return from_clinic_time(candidate.replace(tzinfo=None))


def _overlaps(start: datetime, end: datetime, windows: list[tuple[datetime, datetime]]) -> bool:
    return any(start < window_end and end > window_start for window_start, window_end in windows)


__all__ = ["BookingAdapter", "Slot", "BookingRef", "get_booking_service", "clinic_tz"]
