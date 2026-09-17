"""
Generates three synthetic bank statements, each in a genuinely different
export format, to demonstrate the ingestion layer.

Deterministic - same output every run, so the demo never surprises you.

IMPORTANT: this data is synthetic. It is shaped to look like real SME
banking activity, but no real merchant or account is represented.
"""
import csv
import random
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "sample_data"
START = date(2026, 3, 20)
DAYS = 182


def money(x):
    return round(x, 2)


def fmt_thousands(x):
    return f"{x:,.2f}"


def build_ledger(seed, profile):
    """Produce a list of (date, description, amount) with amount signed."""
    rng = random.Random(seed)
    rows = []
    for offset in range(DAYS):
        day = START + timedelta(days=offset)
        month_index = offset / 30.0

        # Daily settlements, split across the merchant's acquirers.
        # Real merchants take money through several channels - which is what
        # makes revenue concentration a meaningful risk signal.
        if day.weekday() < profile["trading_days"]:
            base = profile["daily_revenue"] * (1 + profile["growth"] * month_index)
            noise = rng.gauss(1.0, profile["volatility"])
            total = max(0.0, base * noise)
            for label, share in profile["settlement_labels"]:
                amount = total * share * rng.gauss(1.0, 0.08)
                if amount > 1:
                    rows.append((day, label, money(amount)))

        # Weekly supplier payments
        if day.weekday() == 2:
            cogs = profile["daily_revenue"] * profile["trading_days"] * profile["cogs_ratio"]
            rows.append((day, "SUPPLIER PAYMENT", -money(cogs * rng.gauss(1.0, 0.12))))

        # Monthly fixed costs
        if day.day == 1:
            rows.append((day, "PAYROLL", -money(profile["payroll"])))
            rows.append((day, "RENT", -money(profile["rent"])))

        # Existing debt service
        if day.day == 15 and profile["debt_service"] > 0:
            rows.append((day, "LOAN REPAYMENT", -money(profile["debt_service"])))

        # Returned / bounced payments - a payment discipline signal
        if offset in profile["bounce_days"]:
            rows.append((day, "RETURNED DEBIT ORDER - UNPAID", -money(profile["payroll"] * 0.04)))

        # A large one-off inflow that is NOT revenue (should not inflate the advance)
        if offset == profile["injection_day"]:
            rows.append((day, "INTER-ACCOUNT TRANSFER FROM DIRECTOR", money(profile["injection"])))

    rows.sort(key=lambda r: r[0])
    return rows


def with_balance(rows, opening):
    bal = opening
    out = []
    for d, desc, amt in rows:
        bal += amt
        out.append((d, desc, amt, money(bal)))
    return out


def write_mashreq(rows, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Txn Date", "Narration", "Withdrawal (AED)", "Deposit (AED)", "Balance (AED)"])
        for d, desc, amt, bal in rows:
            w.writerow([
                d.strftime("%d/%m/%Y"),
                desc,
                fmt_thousands(-amt) if amt < 0 else "",
                fmt_thousands(amt) if amt > 0 else "",
                fmt_thousands(bal),
            ])


def write_fnb(rows, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        # Real FNB exports carry a preamble before the header row.
        f.write("FIRST NATIONAL BANK\n")
        f.write("Statement Period: 2026-03-20 to 2026-09-17\n")
        f.write("Account: ****4471 - BUSINESS CHEQUE\n")
        f.write("\n")
        w = csv.writer(f)
        w.writerow(["Date", "Description", "Amount", "Balance"])
        for d, desc, amt, bal in rows:
            w.writerow([d.strftime("%Y-%m-%d"), desc, f"{amt:.2f}", f"{bal:.2f}"])


def write_alrajhi(rows, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["التاريخ", "البيان", "مدين", "دائن", "الرصيد"])
        for d, desc, amt, bal in rows:
            w.writerow([
                d.strftime("%d-%m-%Y"),
                desc,
                fmt_thousands(-amt) if amt < 0 else "",
                fmt_thousands(amt) if amt > 0 else "",
                fmt_thousands(bal),
            ])


PROFILES = {
    "mashreq_statement.csv": dict(
        seed=11, writer=write_mashreq, opening=145000,
        profile=dict(daily_revenue=9800, growth=0.06, volatility=0.14, trading_days=7,
                     cogs_ratio=0.34, payroll=61000, rent=28000, debt_service=0,
                     bounce_days=set(), injection_day=-1, injection=0,
                     settlement_labels=[("CARD SETTLEMENT NETWORK INTL", 0.46),
                                        ("TALABAT MERCHANT SETTLEMENT", 0.31),
                                        ("DELIVEROO MERCHANT SETTLEMENT", 0.23)]),
    ),
    "fnb_statement.csv": dict(
        seed=23, writer=write_fnb, opening=310000,
        profile=dict(daily_revenue=21500, growth=-0.04, volatility=0.46, trading_days=6,
                     cogs_ratio=0.52, payroll=198000, rent=74000, debt_service=96000,
                     bounce_days={38, 71, 96, 134, 158}, injection_day=64, injection=520000,
                     settlement_labels=[("PAYFAST SETTLEMENT", 0.58),
                                        ("TAKEALOT MERCHANT SETTLEMENT", 0.27),
                                        ("YOCO MERCHANT SETTLEMENT", 0.15)]),
    ),
    "alrajhi_statement.csv": dict(
        seed=37, writer=write_alrajhi, opening=88000,
        profile=dict(daily_revenue=7400, growth=0.11, volatility=0.19, trading_days=6,
                     cogs_ratio=0.41, payroll=44000, rent=19500, debt_service=12000,
                     bounce_days={102}, injection_day=-1, injection=0,
                     settlement_labels=[("MADA POS SETTLEMENT", 0.58),
                                        ("HYPERPAY MERCHANT CREDIT", 0.42)]),
    ),
}


def main():
    OUT.mkdir(exist_ok=True)
    for filename, cfg in PROFILES.items():
        ledger = build_ledger(cfg["seed"], cfg["profile"])
        rows = with_balance(ledger, cfg["opening"])
        cfg["writer"](rows, OUT / filename)
        print(f"  wrote {filename:26} {len(rows):>4} transactions")


if __name__ == "__main__":
    main()
