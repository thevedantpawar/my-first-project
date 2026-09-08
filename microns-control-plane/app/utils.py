"""Small shared helpers."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone


def utcnow() -> datetime:
    """Timezone-naive UTC, matching how the columns are declared.

    ``datetime.utcnow`` is deprecated in 3.12; this keeps the same storage
    shape without the warning.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def slugify(value: str, *, max_length: int = 40) -> str:
    """A URL- and DNS-safe slug.

    Used for clinic slugs, which become part of a Railway service name, so the
    output is restricted to lowercase alphanumerics and single hyphens.
    """
    normalised = unicodedata.normalize("NFKD", value or "")
    ascii_only = normalised.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
    slug = re.sub(r"-{2,}", "-", slug)[:max_length].strip("-")
    return slug or "clinic"


__all__ = ["utcnow", "slugify"]
