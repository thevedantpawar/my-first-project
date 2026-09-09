"""The Leak Audit — a clinic's own enquiry log, read back to them.

This is the mechanism the founding-cohort offer rests on. A prospect exports
the last ninety days of website enquiries; this reads it and answers three
questions:

1. How many arrived outside the clinic's opening hours?
2. How many waited longer than four hours for a reply?
3. What would the qualification engine have scored each one?

It exists because a company with no customers has no case studies, and the
only proof available before the first customer is **the prospect's own data**.
A testimonial is someone else's claim. A leak audit is arithmetic on numbers
they exported themselves, which is why it survives scrutiny that a demo does
not.

Three rules, and they are the same three the console lives by.

**Nothing is inferred.** Real clinic exports are a mess: the reply column is
often missing entirely, timestamps come in six different formats, and half the
rows have an empty message. Where a value cannot be read, the row is counted
as *unknown* and reported as such. A row with no reply timestamp is not a row
with no reply — those are different facts, and conflating them would inflate
the exact number the whole pitch turns on.

**Every figure ships with its denominator.** "62% waited over four hours" is
worth nothing without "of the 34 rows where we could read both timestamps".
The report carries coverage everywhere.

**Scores come from the real engine.** :meth:`LeadService.score_lead` does the
scoring, on a real ``Lead``, exactly as it would for a live enquiry. Nothing
here approximates it — if the engine changes, the audit changes with it.
"""

from __future__ import annotations

import csv
import io
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from app.config import settings
from app.models.lead import Lead, LeadTemperature

logger = logging.getLogger(__name__)

#: A reply slower than this is the gap the offer is about. Four hours is the
#: point at which an aesthetics enquiry has usually already been answered by
#: somebody else — it is a threshold, not a law, so it is a parameter.
DEFAULT_SLOW_REPLY_HOURS = 4.0

#: Column names seen in the wild. Matched case- and punctuation-insensitively
#: against the header row; the first hit wins.
COLUMN_HINTS: dict[str, tuple[str, ...]] = {
    "received": (
        "received", "receivedat", "created", "createdat", "date", "datetime",
        "timestamp", "submitted", "submittedat", "enquirydate", "inquirydate",
        "datesubmitted", "senton", "time",
    ),
    "replied": (
        "replied", "repliedat", "response", "responseat", "responded",
        "respondedat", "firstreply", "firstresponse", "replydate",
        "answeredat", "contacted", "contactedat", "followup", "followupat",
    ),
    "message": (
        "message", "enquiry", "inquiry", "notes", "comments", "comment",
        "details", "request", "body", "text", "question", "interest",
        "treatment", "service", "servicerequested", "treatmentinterest",
    ),
    "name": ("name", "fullname", "firstname", "clientname", "patientname", "contact"),
}

#: Treatment words a med spa enquiry actually uses, mapped to the engine's
#: own service keys. Deliberately narrow: an unrecognised message scores as
#: "other" rather than being guessed into a high-value treatment.
TREATMENT_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"\b(botox|tox|dysport|xeomin|jeuveau|wrinkle|frown|forehead|crow)", "botox"),
    (r"\b(filler|juvederm|restylane|lip|cheek|sculptra|radiesse|volum)", "fillers"),
    (r"\b(laser|ipl|hair removal|resurfac|co2|bbl)", "laser"),
    (r"\b(facial|hydrafacial|microneedl|dermaplan|glow)", "facial"),
    (r"\b(peel|chemical peel|vi peel|tca)", "peel"),
)

URGENCY_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"\b(asap|as soon as|urgent|this week|today|tomorrow|right away|immediat)", "asap"),
    (r"\b(next week|two weeks|couple of weeks|fortnight|1-2 weeks)", "1-2_weeks"),
    (r"\b(next month|this month|within a month|few weeks)", "1_month"),
    (r"\b(just (looking|browsing|curious)|thinking about|considering|price list|how much)", "browsing"),
)

#: Formats tried in order. Nothing is guessed beyond this list — an
#: unparseable timestamp is reported as unreadable rather than coerced.
_DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
    "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M",
    "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y %I:%M %p", "%m/%d/%Y %I:%M:%S %p",
    "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
    "%b %d %Y %I:%M %p", "%d %b %Y %H:%M", "%B %d, %Y %I:%M %p",
    "%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y",
)


def _normalise_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    """Read a timestamp, or return ``None`` if it cannot be read honestly."""
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None

    # ISO with a timezone or a trailing Z — normalise to naive UTC-ish, since
    # the whole audit is done in the clinic's own local frame anyway.
    iso = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(iso)
        return parsed.replace(tzinfo=None)
    except ValueError:
        pass

    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def detect_columns(header: Iterable[str]) -> dict[str, Optional[str]]:
    """Map our four roles onto whatever this clinic called its columns.

    Returned so the caller can print it. A silent mis-mapping is the worst
    failure this tool has: it would produce a confident report about the wrong
    column, and the prospect would be the one to notice.
    """
    columns = list(header or [])
    normalised = {_normalise_header(name): name for name in columns}
    found: dict[str, Optional[str]] = {}

    for role, hints in COLUMN_HINTS.items():
        match = None
        for hint in hints:
            if hint in normalised:
                match = normalised[hint]
                break
        if match is None:
            # Fall back to a containment match — "Date Submitted (UTC)" and
            # friends — but only on the longer hints, so "time" cannot swallow
            # "Response Time".
            for hint in hints:
                if len(hint) < 6:
                    continue
                for key, original in normalised.items():
                    if hint in key:
                        match = original
                        break
                if match:
                    break
        found[role] = match

    # "received" and "replied" must never resolve to the same column.
    if found.get("received") and found["received"] == found.get("replied"):
        found["replied"] = None
    return found


def classify_treatment(message: Optional[str]) -> str:
    """Best-effort service from free text. Unrecognised means 'other'."""
    text = (message or "").lower()
    for pattern, key in TREATMENT_PATTERNS:
        if re.search(pattern, text):
            return key
    return "other"


def classify_timeline(message: Optional[str]) -> Optional[str]:
    text = (message or "").lower()
    for pattern, key in URGENCY_PATTERNS:
        if re.search(pattern, text):
            return key
    return None


@dataclass
class EnquiryRow:
    """One row of the export, after reading — never after guessing."""

    index: int
    received: Optional[datetime]
    replied: Optional[datetime]
    message: str
    name: str
    score: int = 0
    temperature: Optional[str] = None
    treatment: str = "other"

    @property
    def readable(self) -> bool:
        return self.received is not None

    @property
    def wait_hours(self) -> Optional[float]:
        if self.received is None or self.replied is None:
            return None
        delta = (self.replied - self.received).total_seconds() / 3600.0
        # A reply stamped before the enquiry is a broken row, not a negative
        # wait. Report it as unreadable rather than as an instant answer.
        return delta if delta >= 0 else None

    def after_hours(self, open_hour: int, close_hour: int) -> Optional[bool]:
        if self.received is None:
            return None
        hour = self.received.hour
        weekend = self.received.weekday() >= 6  # Sunday
        return weekend or hour < open_hour or hour >= close_hour


@dataclass
class LeakAudit:
    """The finished audit. Every count carries what it was counted from."""

    total_rows: int = 0
    readable_rows: int = 0
    after_hours: int = 0
    weekend: int = 0
    with_reply_time: int = 0
    slow_replies: int = 0
    no_reply_recorded: int = 0
    slow_threshold_hours: float = DEFAULT_SLOW_REPLY_HOURS
    median_wait_hours: Optional[float] = None
    hot: int = 0
    warm: int = 0
    cold: int = 0
    treatments: dict[str, int] = field(default_factory=dict)
    columns: dict[str, Optional[str]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    #: True only if the export carried budget answers. It almost never does.
    scored_budget: bool = False
    #: The highest score reachable from the fields this export actually had.
    score_ceiling: int = 50

    @property
    def after_hours_rate(self) -> float:
        return _rate(self.after_hours, self.readable_rows)

    @property
    def slow_rate(self) -> float:
        return _rate(self.slow_replies, self.with_reply_time)

    @property
    def has_reply_data(self) -> bool:
        return self.with_reply_time > 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "readable_rows": self.readable_rows,
            "after_hours": self.after_hours,
            "after_hours_rate": self.after_hours_rate,
            "weekend": self.weekend,
            "with_reply_time": self.with_reply_time,
            "slow_replies": self.slow_replies,
            "slow_rate": self.slow_rate,
            "slow_threshold_hours": self.slow_threshold_hours,
            "no_reply_recorded": self.no_reply_recorded,
            "median_wait_hours": self.median_wait_hours,
            "scores": {
                "hot": self.hot,
                "warm": self.warm,
                "cold": self.cold,
                "ceiling": self.score_ceiling,
                "budget_available": self.scored_budget,
            },
            "treatments": self.treatments,
            "columns": self.columns,
            "warnings": self.warnings,
            "period": {
                "first": self.first_seen.isoformat() if self.first_seen else None,
                "last": self.last_seen.isoformat() if self.last_seen else None,
            },
        }


def _rate(part: int, whole: int) -> float:
    return round((part / whole) * 100, 1) if whole else 0.0


def _median(values: list[float]) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return round(ordered[middle], 1)
    return round((ordered[middle - 1] + ordered[middle]) / 2, 1)


def audit_csv(
    text: str,
    *,
    scorer=None,
    slow_hours: float = DEFAULT_SLOW_REPLY_HOURS,
    open_hour: Optional[int] = None,
    close_hour: Optional[int] = None,
) -> tuple[LeakAudit, list[EnquiryRow]]:
    """Read an enquiry export and produce the audit.

    ``scorer`` is a callable taking a :class:`Lead` and returning
    ``(score, breakdown, temperature)`` — in practice
    :meth:`LeadService.score_lead`. Passing it in keeps this module free of a
    database session: an audit is arithmetic on someone else's spreadsheet and
    has no business opening a connection or writing a row.
    """
    open_hour = settings.clinic_open_hour if open_hour is None else open_hour
    close_hour = settings.clinic_close_hour if close_hour is None else close_hour

    reader = csv.DictReader(io.StringIO(text))
    columns = detect_columns(reader.fieldnames or [])

    audit = LeakAudit(slow_threshold_hours=slow_hours, columns=columns)

    if not columns.get("received"):
        audit.warnings.append(
            "No enquiry-date column found. Without it nothing can be timed — "
            "ask for an export that includes when each enquiry arrived."
        )
        return audit, []

    if not columns.get("replied"):
        audit.warnings.append(
            "No reply-time column found, so response speed cannot be measured "
            "from this file. After-hours arrivals and lead scores are still "
            "counted; the wait times are simply not in the export."
        )

    rows: list[EnquiryRow] = []
    waits: list[float] = []

    for index, raw in enumerate(reader, start=1):
        received = parse_timestamp(raw.get(columns["received"]))
        replied = (
            parse_timestamp(raw.get(columns["replied"])) if columns.get("replied") else None
        )
        message = str(raw.get(columns["message"]) or "").strip() if columns.get("message") else ""
        name = str(raw.get(columns["name"]) or "").strip() if columns.get("name") else ""

        row = EnquiryRow(
            index=index,
            received=received,
            replied=replied,
            message=message,
            name=name,
            treatment=classify_treatment(message),
        )
        audit.total_rows += 1

        if not row.readable:
            rows.append(row)
            continue

        audit.readable_rows += 1
        audit.first_seen = min(audit.first_seen or received, received)
        audit.last_seen = max(audit.last_seen or received, received)

        if row.after_hours(open_hour, close_hour):
            audit.after_hours += 1
        if received.weekday() >= 6:
            audit.weekend += 1

        wait = row.wait_hours
        if wait is None:
            if columns.get("replied"):
                audit.no_reply_recorded += 1
        else:
            audit.with_reply_time += 1
            waits.append(wait)
            if wait >= slow_hours:
                audit.slow_replies += 1

        if scorer is not None:
            row.score, _breakdown, row.temperature = scorer(_as_lead(row))
            if row.temperature == LeadTemperature.HOT:
                audit.hot += 1
            elif row.temperature == LeadTemperature.WARM:
                audit.warm += 1
            else:
                audit.cold += 1

        audit.treatments[row.treatment] = audit.treatments.get(row.treatment, 0) + 1
        rows.append(row)

    audit.median_wait_hours = _median(waits)
    audit.score_ceiling = _ceiling_without(("budget_range", "previous_experience"))

    unreadable = audit.total_rows - audit.readable_rows
    if unreadable:
        audit.warnings.append(
            f"{unreadable} of {audit.total_rows} rows had an unreadable date and were "
            "left out of every figure below."
        )

    return audit, rows


def _ceiling_without(missing: tuple[str, ...]) -> int:
    """The best score reachable when these answers are absent.

    Derived from the engine's own weights, so it cannot drift out of step
    with the scoring it is describing.
    """
    from app.services.lead_service import SCORE_WEIGHTS

    total = 0
    for key, weights in SCORE_WEIGHTS.items():
        if key in missing:
            continue
        total += max(weights.values()) if weights else 0
    return min(total, 100)


def _as_lead(row: EnquiryRow) -> Lead:
    """A detached Lead carrying only what the export actually said.

    Budget is deliberately left unset. A web form almost never asks for it,
    and inventing one would move the score — the audit reports what the
    engine can know from this data, not a flattering version of it.
    """
    lead = Lead()
    lead.treatment_interest = row.treatment
    lead.timeline = classify_timeline(row.message)
    lead.previous_experience = None
    lead.is_pregnant = None
    lead.blood_thinner = None
    lead.budget_range = None
    return lead


def render_report(audit: LeakAudit, clinic: str) -> str:
    """The plain-text summary to paste into an email.

    Written to be readable by the clinic owner, not by an engineer, and to
    survive being forwarded to whoever actually signs.
    """
    lines: list[str] = []
    add = lines.append

    add(f"ENQUIRY AUDIT — {clinic}")
    add("=" * (16 + len(clinic)))
    add("")

    if audit.first_seen and audit.last_seen:
        span = (audit.last_seen - audit.first_seen).days
        add(
            f"{audit.readable_rows} enquiries, "
            f"{audit.first_seen:%d %b %Y} to {audit.last_seen:%d %b %Y} ({span} days)."
        )
    else:
        add(f"{audit.readable_rows} enquiries.")
    add("")

    add("WHEN THEY ARRIVED")
    add(
        f"  {audit.after_hours} of {audit.readable_rows} ({audit.after_hours_rate}%) "
        "arrived outside your opening hours."
    )
    add(f"  {audit.weekend} of those landed on a Sunday.")
    add("")

    add("HOW LONG THEY WAITED")
    if audit.has_reply_data:
        add(
            f"  {audit.slow_replies} of {audit.with_reply_time} "
            f"({audit.slow_rate}%) waited more than "
            f"{audit.slow_threshold_hours:g} hours for a reply."
        )
        if audit.median_wait_hours is not None:
            add(f"  Median wait: {audit.median_wait_hours:g} hours.")
        if audit.no_reply_recorded:
            add(
                f"  {audit.no_reply_recorded} rows had no reply recorded at all. "
                "That may mean no reply was sent, or simply that your export "
                "does not track it — I have not assumed either."
            )
    else:
        add("  Not measurable from this export — no reply-time column.")
    add("")

    if audit.hot or audit.warm or audit.cold:
        add("WHAT THEY WERE WORTH")
        add(
            f"  {audit.hot} high intent, {audit.warm} medium, {audit.cold} low, "
            "scored by the same engine that would answer them live."
        )
        add(
            "  Scored on treatment and urgency only — a web form rarely asks "
            "budget or prior experience, so neither was assumed."
        )
        if not audit.scored_budget:
            # Without budget and prior experience the engine tops out at 50,
            # which is exactly the boundary of "medium". Reporting "0 high
            # intent" without saying so would read as a verdict on the
            # clinic's leads when it is a limit of the export.
            add(
                f"  Note: with those two answers missing the engine can reach "
                f"at most {audit.score_ceiling} of 100, so nothing in a file "
                "like this can register as high intent. Asked live, the same "
                "enquiries score higher."
            )
        add("")

    if audit.treatments:
        add("WHAT THEY ASKED ABOUT")
        for key, count in sorted(audit.treatments.items(), key=lambda item: -item[1]):
            add(f"  {key:<12} {count}")
        add("")

    add("HOW THIS WAS READ")
    for role, column in audit.columns.items():
        add(f"  {role:<9} <- {column or 'not found'}")
    add("")

    if audit.warnings:
        add("CAVEATS")
        for warning in audit.warnings:
            add(f"  - {warning}")
        add("")

    add(
        "Every figure above is counted from the file you sent. Nothing is "
        "estimated, and where something could not be read it is named rather "
        "than filled in."
    )
    return "\n".join(lines)
