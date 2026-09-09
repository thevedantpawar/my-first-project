"""The Leak Audit.

The audit's whole value is that a prospect can check it against their own
spreadsheet, so the tests are mostly about the ways a real export is messy and
the ways a careless reader would quietly overstate the leak. Every one of the
inflating mistakes below is a mistake that would make the sales number bigger
and the claim false.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from app.services import leak_audit
from app.services.lead_service import LeadService


@pytest.fixture
def scorer(db):
    return LeadService(db).score_lead


def csv_of(rows: str) -> str:
    return rows.strip() + "\n"


# --------------------------------------------------------------------- #
# Reading a real-world file
# --------------------------------------------------------------------- #
def test_columns_are_detected_and_reported():
    text = csv_of(
        """
Date Submitted,First Response At,Message,Full Name
2026-08-04 21:14,2026-08-06 09:30,Botox pricing?,Ava T
"""
    )
    audit, _rows = leak_audit.audit_csv(text)
    assert audit.columns["received"] == "Date Submitted"
    assert audit.columns["replied"] == "First Response At"
    assert audit.columns["message"] == "Message"
    assert audit.columns["name"] == "Full Name"


def test_received_and_replied_never_resolve_to_the_same_column():
    """A silent collision would report every wait as zero."""
    columns = leak_audit.detect_columns(["Date", "Message"])
    assert columns["received"] == "Date"
    assert columns["replied"] is None


@pytest.mark.parametrize(
    "raw",
    [
        "2026-08-04 21:14:00",
        "2026-08-04T21:14",
        "08/04/2026 9:14 PM",
        "2026-08-04T21:14:00Z",
        "Aug 04 2026 09:14 PM",
    ],
)
def test_timestamp_formats_seen_in_the_wild(raw):
    assert leak_audit.parse_timestamp(raw) is not None


def test_an_unreadable_timestamp_is_not_coerced():
    assert leak_audit.parse_timestamp("last Tuesday") is None
    assert leak_audit.parse_timestamp("") is None
    assert leak_audit.parse_timestamp(None) is None


def test_rows_with_unreadable_dates_are_excluded_and_declared():
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,2026-08-05 09:30,Botox
whenever,2026-08-05 09:30,Filler
"""
    )
    audit, _rows = leak_audit.audit_csv(text)
    assert audit.total_rows == 2
    assert audit.readable_rows == 1
    assert any("unreadable date" in warning for warning in audit.warnings)


# --------------------------------------------------------------------- #
# After hours
# --------------------------------------------------------------------- #
def test_after_hours_uses_the_clinic_hours():
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,2026-08-05 09:30,Botox
2026-08-04 11:00,2026-08-04 11:20,Botox
2026-08-04 07:30,2026-08-04 09:30,Botox
"""
    )
    audit, _rows = leak_audit.audit_csv(text, open_hour=9, close_hour=18)
    assert audit.readable_rows == 3
    assert audit.after_hours == 2          # 21:14 and 07:30
    assert audit.after_hours_rate == 66.7


def test_sunday_counts_as_after_hours_and_is_reported_separately():
    # 2026-08-09 is a Sunday.
    text = csv_of(
        """
Date,Replied,Message
2026-08-09 11:00,2026-08-10 09:00,Botox
"""
    )
    audit, _rows = leak_audit.audit_csv(text, open_hour=9, close_hour=18)
    assert audit.after_hours == 1
    assert audit.weekend == 1


# --------------------------------------------------------------------- #
# Wait times — where overstating is easiest
# --------------------------------------------------------------------- #
def test_slow_replies_are_counted_against_rows_that_have_both_timestamps():
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,2026-08-06 09:30,Botox
2026-08-04 10:00,2026-08-04 10:30,Botox
2026-08-04 10:00,,Botox
"""
    )
    audit, _rows = leak_audit.audit_csv(text, slow_hours=4)
    assert audit.with_reply_time == 2, "the row with no reply time is not a wait"
    assert audit.slow_replies == 1
    assert audit.slow_rate == 50.0
    assert audit.no_reply_recorded == 1


def test_a_missing_reply_is_not_reported_as_an_infinite_wait():
    """'No reply recorded' and 'never replied' are different facts."""
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,,Botox
"""
    )
    audit, _rows = leak_audit.audit_csv(text)
    assert audit.slow_replies == 0
    assert audit.with_reply_time == 0
    assert audit.no_reply_recorded == 1


def test_a_reply_stamped_before_the_enquiry_is_treated_as_unreadable():
    """A broken row must not become an instant reply that flatters the clinic."""
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,2026-08-01 09:00,Botox
"""
    )
    audit, rows = leak_audit.audit_csv(text)
    assert rows[0].wait_hours is None
    assert audit.with_reply_time == 0


def test_no_reply_column_disables_wait_figures_and_says_so():
    text = csv_of(
        """
Date,Message
2026-08-04 21:14,Botox
2026-08-04 10:00,Filler
"""
    )
    audit, _rows = leak_audit.audit_csv(text)
    assert audit.has_reply_data is False
    assert audit.readable_rows == 2, "after-hours is still countable"
    assert any("reply-time column" in warning for warning in audit.warnings)


def test_median_wait_is_reported():
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 10:00,2026-08-04 12:00,Botox
2026-08-04 10:00,2026-08-04 14:00,Botox
2026-08-04 10:00,2026-08-04 20:00,Botox
"""
    )
    audit, _rows = leak_audit.audit_csv(text)
    assert audit.median_wait_hours == 4.0


def test_no_date_column_produces_nothing_rather_than_a_guess():
    audit, rows = leak_audit.audit_csv(csv_of("Name,Message\nAva,Botox"))
    assert rows == []
    assert audit.readable_rows == 0
    assert any("enquiry-date column" in warning for warning in audit.warnings)


# --------------------------------------------------------------------- #
# Scoring — must be the real engine
# --------------------------------------------------------------------- #
def test_scores_come_from_the_real_engine(scorer, db):
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,2026-08-06 09:30,Looking for Botox as soon as possible
"""
    )
    audit, rows = leak_audit.audit_csv(text, scorer=scorer)
    assert audit.hot + audit.warm + audit.cold == 1

    from app.models.lead import Lead

    expected = Lead()
    expected.treatment_interest = "botox"
    expected.timeline = "asap"
    score, _breakdown, temperature = scorer(expected)
    assert rows[0].score == score
    assert rows[0].temperature == temperature


def test_budget_is_never_invented(scorer):
    """A web form rarely asks budget; assuming one moves the score upward."""
    text = csv_of(
        """
Date,Message
2026-08-04 21:14,Botox asap
"""
    )
    _audit, rows = leak_audit.audit_csv(text, scorer=scorer)
    lead = leak_audit._as_lead(rows[0])
    assert lead.budget_range is None


def test_an_unrecognised_message_scores_as_other_not_as_a_treatment(scorer):
    text = csv_of(
        """
Date,Message
2026-08-04 21:14,Do you validate parking
"""
    )
    audit, rows = leak_audit.audit_csv(text, scorer=scorer)
    assert rows[0].treatment == "other"
    assert audit.treatments["other"] == 1


@pytest.mark.parametrize(
    "message,expected",
    [
        ("Interested in Dysport for my forehead", "botox"),
        ("How much for lip filler?", "fillers"),
        ("laser hair removal on legs", "laser"),
        ("hydrafacial availability", "facial"),
        ("VI peel pricing", "peel"),
        ("", "other"),
    ],
)
def test_treatment_classification(message, expected):
    assert leak_audit.classify_treatment(message) == expected


@pytest.mark.parametrize(
    "message,expected",
    [
        ("can I come in asap", "asap"),
        ("thinking about next week", "1-2_weeks"),
        ("just browsing for now", "browsing"),
        ("hello", None),
    ],
)
def test_timeline_classification(message, expected):
    assert leak_audit.classify_timeline(message) == expected


# --------------------------------------------------------------------- #
# The report a prospect actually reads
# --------------------------------------------------------------------- #
def test_report_carries_denominators_not_bare_percentages(scorer):
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,2026-08-06 09:30,Botox asap
2026-08-04 10:00,2026-08-04 10:30,Filler
"""
    )
    audit, _rows = leak_audit.audit_csv(text, scorer=scorer)
    report = leak_audit.render_report(audit, "Glow Aesthetics")

    assert "Glow Aesthetics" in report
    assert "1 of 2" in report, "every rate must show what it was counted from"
    assert "HOW THIS WAS READ" in report, "column mapping must be visible"


def test_report_says_when_waits_are_not_measurable():
    text = csv_of(
        """
Date,Message
2026-08-04 21:14,Botox
"""
    )
    audit, _rows = leak_audit.audit_csv(text)
    report = leak_audit.render_report(audit, "Test Clinic")
    assert "Not measurable from this export" in report


def test_report_does_not_claim_no_reply_means_never_replied():
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,,Botox
2026-08-04 10:00,2026-08-04 10:30,Filler
"""
    )
    audit, _rows = leak_audit.audit_csv(text)
    report = leak_audit.render_report(audit, "Test Clinic")
    assert "no reply recorded" in report
    assert "have not assumed either" in report


def test_audit_writes_nothing_to_the_database(db, scorer):
    """An audit reads a stranger's spreadsheet; it must not persist anything."""
    from sqlalchemy import func, select
    from app.models.lead import Lead

    before = db.execute(select(func.count(Lead.id))).scalar_one()
    text = csv_of(
        """
Date,Replied,Message
2026-08-04 21:14,2026-08-06 09:30,Botox asap
"""
    )
    leak_audit.audit_csv(text, scorer=scorer)
    db.rollback()
    assert db.execute(select(func.count(Lead.id))).scalar_one() == before


def test_period_span_is_taken_from_the_data(scorer):
    text = csv_of(
        """
Date,Message
2026-06-01 10:00,Botox
2026-08-30 10:00,Filler
2026-07-15 10:00,Laser
"""
    )
    audit, _rows = leak_audit.audit_csv(text, scorer=scorer)
    assert audit.first_seen == datetime(2026, 6, 1, 10, 0)
    assert audit.last_seen == datetime(2026, 8, 30, 10, 0)


def test_the_report_explains_why_nothing_scores_hot(scorer):
    """A web export lacks budget, so "0 high intent" is a limit, not a verdict."""
    text = csv_of(
        """
Date,Message
2026-08-04 21:14,Botox as soon as possible
"""
    )
    audit, _rows = leak_audit.audit_csv(text, scorer=scorer)

    assert audit.hot == 0
    assert audit.scored_budget is False

    report = leak_audit.render_report(audit, "Test Clinic")
    assert "can reach at most" in report
    assert "score higher" in report


def test_the_ceiling_is_derived_from_the_engines_own_weights():
    """Hardcoding 50 would drift the moment the weights changed."""
    from app.services.lead_service import SCORE_WEIGHTS

    ceiling = leak_audit._ceiling_without(("budget_range", "previous_experience"))
    expected = max(SCORE_WEIGHTS["treatment_interest"].values()) + max(
        SCORE_WEIGHTS["timeline"].values()
    )
    assert ceiling == expected
