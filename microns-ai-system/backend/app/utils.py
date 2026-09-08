"""Small shared helpers: time handling and PHI-safe formatting.

Time policy for the whole codebase: **every datetime stored or compared is
naive UTC.** Timezone-aware values are converted on the way in
(:func:`to_utc_naive`) and only converted back to the clinic's local zone at
the edges — SMS copy, voice replies, dashboards (:func:`to_clinic_time`).

Mixing aware and naive datetimes raises ``TypeError`` at runtime, and the
SQLite/PostgreSQL drivers disagree about what they hand back, so the single
rule above is worth more than per-call cleverness.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import settings


def utcnow() -> datetime:
    """Current UTC time, naive — the canonical 'now' for this system."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_utc_naive(value: Optional[datetime]) -> Optional[datetime]:
    """Coerce any datetime to naive UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def parse_datetime(value) -> Optional[datetime]:
    """Parse an ISO-8601 string (``Z`` suffix included) into naive UTC."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return to_utc_naive(value)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        return to_utc_naive(datetime.fromisoformat(text))
    except ValueError:
        return None


#: An explicit UTC offset or ``Z`` at the end of an ISO-8601 string.
#: Four digits are required, so a bare date's ``-09-15`` does not match.
_EXPLICIT_OFFSET = re.compile(r"(?:Z|[+-]\d{2}:?\d{2})$")


def parse_wall_clock(value) -> Optional[datetime]:
    """Parse a time a human named out loud, into naive UTC.

    Identical to :func:`parse_datetime` except in what a *missing* timezone
    means. A caller who asks for "two o'clock" means two o'clock where the
    clinic is, and a voice agent transcribing that has no offset to attach.
    Treating it as UTC books an America/New_York clinic four hours early — the
    caller asks for 2pm, the appointment lands at 10am — and nothing about the
    stored record looks wrong afterwards. It is found when somebody arrives.

    An explicit offset is still honoured. The engine's own slot values carry
    one, so echoing a slot back has to round-trip exactly rather than being
    shifted a second time.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return from_clinic_time(value) if value.tzinfo is None else to_utc_naive(value)

    text = str(value).strip()
    parsed = parse_datetime(text)
    if parsed is None:
        return None
    return parsed if _EXPLICIT_OFFSET.search(text) else from_clinic_time(parsed)


def clinic_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.clinic_timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def to_clinic_time(value: datetime) -> datetime:
    """Naive UTC -> aware clinic-local, for anything a human will read."""
    return value.replace(tzinfo=timezone.utc).astimezone(clinic_tz())


def from_clinic_time(value: datetime) -> datetime:
    """Naive clinic-local -> naive UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=clinic_tz())
    return to_utc_naive(value)


def format_appointment_time(value: datetime) -> str:
    """'Tuesday, March 4 at 2:30 PM' — the format used in SMS and voice copy."""
    local = to_clinic_time(value)
    hour = local.strftime("%I").lstrip("0") or "12"
    return f"{local.strftime('%A, %B')} {local.day} at {hour}:{local.strftime('%M %p')}"


def hours_until(value: datetime, now: Optional[datetime] = None) -> float:
    return ((value - (now or utcnow())).total_seconds()) / 3600.0


def days_ago(days: int, now: Optional[datetime] = None) -> datetime:
    return (now or utcnow()) - timedelta(days=days)


def mask_phone(phone: Optional[str]) -> str:
    """Last four digits only — safe for an operator-facing dashboard.

    Still avoid putting even this in application logs; use the patient UUID.
    """
    if not phone:
        return ""
    digits = "".join(char for char in str(phone) if char.isdigit())
    return f"***-***-{digits[-4:]}" if len(digits) >= 4 else "***"


def mask_name(name: Optional[str]) -> str:
    """'Jane Doe' -> 'Jane D.' for staff-facing summaries."""
    if not name:
        return ""
    parts = [part for part in str(name).strip().split() if part]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."
