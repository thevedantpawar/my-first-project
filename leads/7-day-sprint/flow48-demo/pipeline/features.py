"""
Turns canonical transactions into the underwriting features a
revenue-based financing decision actually needs.

The classification rules are deliberately kept as data, not buried in
conditionals, so a credit analyst can extend them without an engineer.
"""
import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from statistics import mean, pstdev

# Credit policy lives in rules/income_rules.json, not in this file. An
# analyst can add a newly-supported payment processor without an engineer
# and without a deploy.
#
# The non_revenue_inflow rules matter most: counting a director's loan as
# trading revenue would inflate the advance, which is the single most
# expensive mistake in revenue-based underwriting.
RULES_PATH = Path(__file__).parent.parent / "rules" / "income_rules.json"


def load_rules(path: Path = RULES_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


_R = load_rules()
NON_REVENUE_INFLOW = _R["non_revenue_inflow"]
REVENUE_INFLOW = _R["revenue_inflow"]
DEBT_SERVICE = _R["debt_service"]
FAILED_PAYMENT = _R["failed_payment"]
HIGH_RISK_COUNTERPARTY = _R["high_risk_counterparty"]


def _matches(description: str, patterns: list[str]) -> bool:
    d = description.lower()
    return any(p in d for p in patterns)


@dataclass
class Features:
    currency: str
    history_days: int
    months_observed: int

    avg_monthly_revenue: float
    revenue_volatility: float        # coefficient of variation, lower is better
    revenue_trend: float             # fractional change, first month to last

    min_balance: float
    days_below_zero: int

    failed_payment_count: int
    debt_service_monthly: float
    debt_service_ratio: float        # debt service / revenue

    top_counterparty_share: float    # revenue concentration

    excluded_inflows: float          # inflows correctly kept out of revenue
    unclassified_inflow_share: float

    risk_flags: list[str] = field(default_factory=list)
    monthly_revenue: dict = field(default_factory=dict)


def extract(transactions, currency: str) -> Features:
    if not transactions:
        raise ValueError("no transactions to analyse")

    first, last = transactions[0].date, transactions[-1].date
    history_days = (last - first).days + 1

    monthly_revenue = defaultdict(float)
    monthly_debt = defaultdict(float)
    counterparty_revenue = defaultdict(float)

    excluded_inflows = 0.0
    unclassified_inflows = 0.0
    total_inflows = 0.0
    failed_payments = 0
    risk_flags: list[str] = []

    for t in transactions:
        month = (t.date.year, t.date.month)

        if _matches(t.description, HIGH_RISK_COUNTERPARTY):
            flag = f"high-risk counterparty: {t.description[:40]}"
            if flag not in risk_flags:
                risk_flags.append(flag)

        if t.amount > 0:
            total_inflows += t.amount
            if _matches(t.description, NON_REVENUE_INFLOW):
                excluded_inflows += t.amount
            elif _matches(t.description, REVENUE_INFLOW):
                monthly_revenue[month] += t.amount
                counterparty_revenue[t.description] += t.amount
            else:
                # Unknown inflow. Conservatively excluded from revenue, but
                # tracked - a high share here means the adapter needs a rule.
                unclassified_inflows += t.amount
        else:
            if _matches(t.description, FAILED_PAYMENT):
                failed_payments += 1
            elif _matches(t.description, DEBT_SERVICE):
                monthly_debt[month] += abs(t.amount)

    # Drop partial months at each end so averages are not distorted
    months = sorted(monthly_revenue)
    if len(months) > 2:
        months = months[1:-1]
    revenues = [monthly_revenue[m] for m in months] or [0.0]

    avg_revenue = mean(revenues)
    volatility = (pstdev(revenues) / avg_revenue) if avg_revenue and len(revenues) > 1 else 0.0
    trend = ((revenues[-1] - revenues[0]) / revenues[0]) if len(revenues) > 1 and revenues[0] else 0.0

    balances = [t.balance for t in transactions if t.balance is not None]
    min_balance = min(balances) if balances else 0.0
    days_below_zero = sum(1 for b in balances if b < 0)

    debt_values = [monthly_debt[m] for m in months] if months else []
    avg_debt = mean(debt_values) if debt_values else 0.0

    top_share = 0.0
    if counterparty_revenue:
        total_rev = sum(counterparty_revenue.values())
        top_share = max(counterparty_revenue.values()) / total_rev if total_rev else 0.0

    return Features(
        currency=currency,
        history_days=history_days,
        months_observed=len(months),
        avg_monthly_revenue=avg_revenue,
        revenue_volatility=volatility,
        revenue_trend=trend,
        min_balance=min_balance,
        days_below_zero=days_below_zero,
        failed_payment_count=failed_payments,
        debt_service_monthly=avg_debt,
        debt_service_ratio=(avg_debt / avg_revenue) if avg_revenue else 0.0,
        top_counterparty_share=top_share,
        excluded_inflows=excluded_inflows,
        unclassified_inflow_share=(unclassified_inflows / total_inflows) if total_inflows else 0.0,
        risk_flags=risk_flags,
        monthly_revenue={f"{y}-{m:02d}": v for (y, m), v in sorted(monthly_revenue.items())},
    )
