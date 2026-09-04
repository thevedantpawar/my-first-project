"""Service pricing — what an appointment is worth, and where that figure came from.

Every revenue number this product shows an owner traces back to a price on an
``Appointment`` row. Before V4 nothing ever wrote one, so the revenue console
was structurally incapable of reporting anything but zero.

This module fixes that, and the *how* matters more than the *that*:

**A recorded price and an expected price are not the same claim.**

``recorded``
    The figure came from outside this system — a booking platform returned it,
    or a member of staff typed it. It is what the clinic is actually charging
    this patient for this appointment.

``expected``
    The figure came from the clinic's own service price list, applied at
    booking time because nothing better was available. It is a forecast built
    from the clinic's published prices, not money anyone has collected.

The two are stored the same way (``price_cents``) but tagged differently
(``extra["price_source"]``), and :meth:`ConsoleService.revenue` reports them
separately. An owner looking at a "revenue influenced" figure can always ask
"is that real or projected?" and the interface can answer, because the answer
is on the row.

Nothing here estimates, models, or infers a price. If a service has no
configured value, the appointment is written with ``price_cents = None`` and
the console reports the gap in its coverage line rather than filling it in.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger(__name__)

# Where a price on an appointment came from. Stored in Appointment.extra so
# that adding it needs no migration on an existing clinic database.
PRICE_SOURCE_RECORDED = "recorded"
PRICE_SOURCE_EXPECTED = "clinic_price_list"

#: Booking values for the services the qualification engine knows about.
#:
#: These are the *appointment* values a clinic books each service at, which is
#: a different question from the per-unit or per-syringe pricing a patient is
#: quoted on the phone. Botox at "$12 per unit" is not a $12 appointment.
#:
#: They are deliberately conservative, and every clinic is expected to replace
#: them — see ``SERVICE_PRICE_LIST_PATH``. They ship so that a fresh clone
#: produces a working revenue console instead of an empty one.
DEFAULT_BOOKING_VALUES: dict[str, int] = {
    "botox": 42000,        # ~$420, one to two areas
    "fillers": 75000,      # ~$750, one syringe
    "laser": 22000,        # ~$220, single session
    "facial": 18000,       # ~$180
    "peel": 24000,         # ~$240
    "consultation": 0,     # complimentary, and genuinely zero
    "other": 0,            # unknown service — carries no value claim
}

_cache: Optional[dict[str, int]] = None


def _load_from_file(path: Path) -> dict[str, int]:
    """Read booking values out of a clinic's price list.

    Accepts the same file the voice agent quotes from. A service is only
    picked up when it carries an explicit ``booking_value`` in dollars —
    ``from`` is a starting price, not an appointment value, and silently
    treating one as the other is how a console ends up reporting $12 Botox.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    values: dict[str, int] = {}
    for key, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        value = entry.get("booking_value")
        if value is None:
            continue
        try:
            values[key] = int(round(float(value) * 100))
        except (TypeError, ValueError):
            logger.warning("Ignoring non-numeric booking_value for service %r", key)
    return values


def booking_values() -> dict[str, int]:
    """The clinic's service → cents map, cached after the first read."""
    global _cache
    if _cache is not None:
        return _cache

    values = dict(DEFAULT_BOOKING_VALUES)
    configured = settings.service_price_list_path
    if configured:
        path = Path(configured)
        try:
            values.update(_load_from_file(path))
            logger.info("Loaded clinic booking values from %s", path)
        except FileNotFoundError:
            logger.warning(
                "SERVICE_PRICE_LIST_PATH points at %s, which does not exist. "
                "Falling back to the built-in booking values.",
                path,
            )
        except (OSError, json.JSONDecodeError) as exc:
            # A malformed price list must not take the booking flow down: an
            # appointment with no price is recoverable, a 500 on the phone
            # line is not.
            logger.error("Could not read the clinic price list: %s", type(exc).__name__)

    _cache = values
    return _cache


def reset_cache() -> None:
    """Drop the cached price list. Used by tests and by the CLI."""
    global _cache
    _cache = None


def _normalise(service: Optional[str]) -> Optional[str]:
    if not service:
        return None
    return service.strip().lower().replace(" ", "_")


def expected_value_cents(service: Optional[str]) -> Optional[int]:
    """The clinic's list value for ``service``, or ``None`` if it has none.

    ``None`` is a real answer and callers must preserve it. A service the
    clinic has not priced has no value, and writing a zero would turn "we
    don't know" into "it is worth nothing" — two very different lines on a
    revenue report.
    """
    key = _normalise(service)
    if key is None:
        return None
    return booking_values().get(key)


def apply_expected_price(appointment: Any) -> None:
    """Stamp an appointment with its expected value, if it has none already.

    Called at every creation site. Deliberately does nothing when a price is
    already present: a figure that came back from a booking platform is
    better evidence than our price list and must never be overwritten by it.
    """
    if appointment.price_cents is not None:
        return

    value = expected_value_cents(appointment.service)
    if value is None:
        return

    appointment.price_cents = value
    # Appointment.extra is the existing ``metadata`` JSON column, so tagging
    # the source needs no schema change on a clinic already in production.
    extra = dict(appointment.extra or {})
    extra["price_source"] = PRICE_SOURCE_EXPECTED
    appointment.extra = extra


def mark_recorded_price(appointment: Any, price_cents: Optional[int]) -> None:
    """Record a price that came from outside this system.

    Used when a booking platform returns a real charge, or staff enters one.
    This is the stronger claim of the two, so it overwrites an expected value.
    """
    if price_cents is None:
        return
    appointment.price_cents = int(price_cents)
    extra = dict(appointment.extra or {})
    extra["price_source"] = PRICE_SOURCE_RECORDED
    appointment.extra = extra


def price_source(appointment: Any) -> Optional[str]:
    """How this appointment came by its price, or ``None`` if it has none."""
    if appointment.price_cents is None:
        return None
    return (appointment.extra or {}).get("price_source", PRICE_SOURCE_RECORDED)
