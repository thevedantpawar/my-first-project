"""
Transparent risk scoring and advance sizing.

Every score is decomposed into named factors with their own contribution.
Nothing is a black box - in regulated lending you have to be able to tell
an applicant, and a regulator, why the answer was no.
"""
from dataclasses import dataclass, field

WEIGHTS = {
    "revenue_stability": 0.25,
    "revenue_trend": 0.15,
    "cashflow_health": 0.20,
    "payment_discipline": 0.20,
    "debt_burden": 0.15,
    "concentration": 0.05,
}

AUTO_APPROVE_AT = 70
DECLINE_BELOW = 45


@dataclass
class Factor:
    name: str
    raw: str
    points: float        # 0-100 before weighting
    weight: float
    assessable: bool = True   # False when the inputs cannot support a verdict

    @property
    def contribution(self) -> float:
        return self.points * self.weight if self.assessable else 0.0


@dataclass
class Assessment:
    score: float
    decision: str                       # APPROVE | REFER | DECLINE
    factors: list[Factor] = field(default_factory=list)
    exceptions: list[str] = field(default_factory=list)
    advance_amount: float = 0.0
    factor_rate: float = 0.0
    currency: str = ""

    @property
    def automated(self) -> bool:
        return self.decision in ("APPROVE", "DECLINE") and not self.exceptions


def _band(value, best, worst, invert=False):
    """Map a value onto 0-100, clamped."""
    if invert:
        value, best, worst = -value, -best, -worst
    if worst == best:
        return 100.0
    pct = (value - worst) / (best - worst) * 100
    return max(0.0, min(100.0, pct))


def assess(f, ingest_result) -> Assessment:
    factors = [
        Factor("revenue_stability",
               f"volatility {f.revenue_volatility:.0%}",
               _band(f.revenue_volatility, best=0.05, worst=0.55, invert=True),
               WEIGHTS["revenue_stability"]),
        Factor("revenue_trend",
               f"{f.revenue_trend:+.0%} over {f.months_observed} months",
               _band(f.revenue_trend, best=0.25, worst=-0.25),
               WEIGHTS["revenue_trend"]),
        Factor("cashflow_health",
               f"min balance {f.min_balance:,.0f}, {f.days_below_zero} days negative",
               _band(f.min_balance / f.avg_monthly_revenue if f.avg_monthly_revenue else 0,
                     best=0.5, worst=-0.2),
               WEIGHTS["cashflow_health"]),
        Factor("payment_discipline",
               f"{f.failed_payment_count} returned payments",
               _band(f.failed_payment_count, best=0, worst=6, invert=True),
               WEIGHTS["payment_discipline"]),
        Factor("debt_burden",
               f"debt service {f.debt_service_ratio:.0%} of revenue",
               _band(f.debt_service_ratio, best=0.0, worst=0.35, invert=True),
               WEIGHTS["debt_burden"]),
        Factor("concentration",
               f"top counterparty {f.top_counterparty_share:.0%}",
               _band(f.top_counterparty_share, best=0.3, worst=0.9, invert=True),
               WEIGHTS["concentration"]),
    ]

    # A factor computed from incomplete inputs is worse than no factor at all:
    # it produces a confident wrong number. Where we cannot see enough of the
    # picture, mark the factor unassessable and renormalise the remaining
    # weights rather than silently scoring it zero.
    if f.unclassified_inflow_share > 0.15:
        for x in factors:
            if x.name == "concentration":
                x.assessable = False
                x.raw = (f"not assessable - {f.unclassified_inflow_share:.0%} "
                         f"of inflows unclassified")

    live_weight = sum(x.weight for x in factors if x.assessable)
    score = sum(x.contribution for x in factors) / live_weight if live_weight else 0.0

    # Hard exceptions. These route to a human no matter how good the score is.
    exceptions = []
    if f.history_days < 90:
        exceptions.append(f"insufficient history: {f.history_days} days (need 90)")
    if f.months_observed < 3:
        exceptions.append(f"only {f.months_observed} complete months observed")
    if ingest_result.reject_rate > 0.02:
        exceptions.append(f"parse quality: {ingest_result.reject_rate:.1%} of rows rejected")
    if f.unclassified_inflow_share > 0.15:
        exceptions.append(
            f"{f.unclassified_inflow_share:.0%} of inflows unclassified - adapter needs a rule")
    for flag in f.risk_flags:
        exceptions.append(flag)

    if exceptions:
        decision = "REFER"
    elif score >= AUTO_APPROVE_AT:
        decision = "APPROVE"
    elif score < DECLINE_BELOW:
        decision = "DECLINE"
    else:
        decision = "REFER"

    advance = 0.0
    rate = 0.0
    if decision in ("APPROVE", "REFER") and f.avg_monthly_revenue > 0:
        # Advance multiple scales with score; capped conservatively.
        multiple = 0.6 + (score / 100) * 0.9          # 0.6x - 1.5x monthly revenue
        headroom = max(0.0, 1 - f.debt_service_ratio)  # existing debt reduces capacity
        advance = f.avg_monthly_revenue * multiple * headroom
        rate = round(1.28 - (score / 100) * 0.16, 4)   # better score, cheaper money

    return Assessment(
        score=score,
        decision=decision,
        factors=factors,
        exceptions=exceptions,
        advance_amount=advance,
        factor_rate=rate,
        currency=f.currency,
    )
