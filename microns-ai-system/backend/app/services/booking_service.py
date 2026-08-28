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


class CalComBookingAdapter(BookingAdapter):
    """Cal.com v2 API (Bearer token), one event type per service.

    ``settings.calcom_event_type_ids`` maps a service name to a Cal.com event
    type id — create one event type per treatment category (consult,
    injectable follow-up, laser session, ...) in the Cal.com dashboard and
    paste the ids into ``.env``. Cal.com is the calendar *bridge*: it syncs to
    Google Calendar/Outlook on its own side, so this adapter only ever talks
    to Cal.com's API, never the calendar directly.

    Written against Cal.com's documented v2 REST API. As with Acuity and
    Square above, verify the exact slot/booking response shape against a
    sandbox account before go-live — Cal.com has shipped breaking changes to
    ``/v2/slots`` between API versions.

    Cal.com's booking endpoint requires an attendee email. Med spa callers
    give a phone number, not an email, so one is synthesised
    (``<phone>@sms.placeholder``) when the patient has none on file. That is a
    workaround, not a real address — collect email during booking if you want
    real Cal.com confirmation emails to reach the patient.
    """

    name = "calcom"

    def __init__(self, db: Session) -> None:
        super().__init__(db)
        self._fallback = InternalBookingAdapter(db)
        self._api_key = settings.calcom_api_key
        self._event_types = settings.calcom_event_type_ids

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "cal-api-version": "2024-08-13",
            "Content-Type": "application/json",
        }

    def _event_type_id(self, service: str) -> Optional[int]:
        value = self._event_types.get(service)
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    def get_available_slots(self, *, service: str, days_ahead: int = 7, limit: int = 12) -> list[Slot]:
        event_type_id = self._event_type_id(service)
        if not self._api_key or event_type_id is None or httpx is None:
            return self._fallback.get_available_slots(service=service, days_ahead=days_ahead, limit=limit)

        now = utcnow()
        try:
            response = httpx.get(
                f"{settings.calcom_api_base_url}/slots",
                headers=self._headers,
                params={
                    "eventTypeId": event_type_id,
                    "start": now.isoformat() + "Z",
                    "end": (now + timedelta(days=days_ahead)).isoformat() + "Z",
                    "timeZone": settings.clinic_timezone,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json().get("data", {})
        except Exception as exc:
            logger.error("Cal.com slots lookup failed: %s", type(exc).__name__)
            return self._fallback.get_available_slots(service=service, days_ahead=days_ahead, limit=limit)

        slots: list[Slot] = []
        # Cal.com groups slots by ISO date: {"2026-01-01": [{"start": "..."}], ...}
        for day_slots in (data.values() if isinstance(data, dict) else []):
            for entry in day_slots or []:
                start = parse_datetime(entry.get("start"))
                if start is None:
                    continue
                slots.append(
                    Slot(start=start, end=start + timedelta(minutes=settings.appointment_slot_minutes))
                )
                if len(slots) >= limit:
                    break
            if len(slots) >= limit:
                break

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
        event_type_id = self._event_type_id(service)
        if not self._api_key or event_type_id is None or httpx is None:
            return self._fallback.create_booking(
                service=service,
                start=start,
                patient_name=patient_name,
                patient_phone=patient_phone,
                patient_email=patient_email,
                duration_minutes=duration_minutes,
            )
        placeholder_email = f"{(patient_phone or 'patient').lstrip('+')}@sms.placeholder"
        try:
            response = httpx.post(
                f"{settings.calcom_api_base_url}/bookings",
                headers=self._headers,
                json={
                    "eventTypeId": event_type_id,
                    "start": start.isoformat() + "Z",
                    "attendee": {
                        "name": patient_name or "Patient",
                        "email": patient_email or placeholder_email,
                        "phoneNumber": patient_phone,
                        "timeZone": settings.clinic_timezone,
                    },
                    "metadata": {"service": service},
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json().get("data", {})
            return BookingRef(
                external_id=str(data.get("uid") or data.get("id") or "") or None,
                confirmed=True,
                provider_name=self.name,
                raw=data,
            )
        except Exception as exc:
            logger.error("Cal.com booking failed: %s — recorded locally instead", type(exc).__name__)
            return BookingRef(external_id=None, confirmed=False, provider_name=self.name, raw={})

    def cancel_booking(self, external_id: str) -> bool:
        if not self._api_key or httpx is None:
            return True
        try:
            response = httpx.post(
                f"{settings.calcom_api_base_url}/bookings/{external_id}/cancel",
                headers=self._headers,
                json={"cancellationReason": "Cancelled by clinic"},
                timeout=10.0,
            )
            response.raise_for_status()
            return True
        except Exception as exc:
            logger.error("Cal.com cancel failed: %s", type(exc).__name__)
            return False


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


_ADAPTERS = {
    "generic": InternalBookingAdapter,
    "internal": InternalBookingAdapter,
    "acuity": AcuityBookingAdapter,
    "square": SquareBookingAdapter,
    "calcom": CalComBookingAdapter,
    "mindbody": MindbodyBookingAdapter,
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
