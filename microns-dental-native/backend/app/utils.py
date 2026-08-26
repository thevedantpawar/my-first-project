"""Small shared helpers: time handling and PHI-safe formatting.

Time policy for the whole codebase: **every datetime stored or compared is
naive UTC.** Timezone-aware values are converted on the way in
(:func:`to_utc_naive`) and only converted back to the practice's local zone at
the edges — SMS copy, voice replies, dashboards (:func:`to_practice_time`).

Mixing aware and naive datetimes raises ``TypeError`` at runtime, and the
SQLite/PostgreSQL drivers disagree about what they hand back, so the single
rule above is worth more than per-call cleverness.
"""

from __future__ import annotations

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


def practice_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.practice_timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def to_practice_time(value: datetime) -> datetime:
    """Naive UTC -> aware practice-local, for anything a human will read."""
    return value.replace(tzinfo=timezone.utc).astimezone(practice_tz())


def from_practice_time(value: datetime) -> datetime:
    """Naive practice-local -> naive UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=practice_tz())
    return to_utc_naive(value)


def format_appointment_time(value: datetime) -> str:
    """'Tuesday, March 4 at 2:30 PM' — the format used in SMS and voice copy."""
    local = to_practice_time(value)
    hour = local.strftime("%I").lstrip("0") or "12"
    return f"{local.strftime('%A, %B')} {local.day} at {hour}:{local.strftime('%M %p')}"


def is_after_hours(now: Optional[datetime] = None) -> bool:
    """Mon-Thu after 5pm/before 8am, Fri after 2pm/before 8am, or any weekend.

    Used by the emergency-capture voice/SMS path to decide whether a missed
    call needs the after-hours triage flow.
    """
    local = to_practice_time(now or utcnow())
    day = local.weekday()  # Mon=0 .. Sun=6
    if day >= 5:
        return True
    if day <= 3:  # Mon-Thu
        return local.hour >= settings.practice_close_hour_mon_thu or local.hour < settings.practice_open_hour
    # Friday
    return local.hour >= settings.practice_close_hour_fri or local.hour < settings.practice_open_hour


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
