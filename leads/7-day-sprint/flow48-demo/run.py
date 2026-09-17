#!/usr/bin/env python3
"""
Flow48 ingestion + underwriting prototype.

    python3 run.py

Three SME applicants, three banks, three countries, three completely
different statement formats. One pipeline. Zero code changes between them.

Synthetic data - see make_samples.py.
"""
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from pipeline import ingest as ing          # noqa: E402
from pipeline import features as feat       # noqa: E402
from pipeline import score as scoring       # noqa: E402

W = 74

APPLICANTS = [
    ("Al Naseem Restaurant Group", "ae_mashreq.json", "mashreq_statement.csv"),
    ("Kruger Online Retail (Pty) Ltd", "za_fnb.json", "fnb_statement.csv"),
    ("Riyadh Home Essentials Trading", "sa_alrajhi.json", "alrajhi_statement.csv"),
]

BADGE = {"APPROVE": "APPROVED", "REFER": "REFER TO ANALYST", "DECLINE": "DECLINED"}


def rule(ch="-"):
    print(ch * W)


def bar(points, width=22):
    filled = int(round(points / 100 * width))
    return "#" * filled + "." * (width - filled)


def main():
    print()
    rule("=")
    print("  FLOW48  ·  SME UNDERWRITING INGESTION PROTOTYPE".center(W))
    rule("=")
    print("  Three banks. Three countries. Three export formats. One pipeline.")
    print("  Adding a market is a JSON adapter, not a rewrite.")
    print()

    # Generate the synthetic statements on first run so a fresh clone works.
    if not all((HERE / "sample_data" / f).exists() for _, _, f in APPLICANTS):
        print("  Sample statements not found - generating them:")
        import make_samples
        make_samples.main()
        print()

    t0 = time.perf_counter()
    assessments = []

    for name, adapter_file, statement_file in APPLICANTS:
        adapter = ing.load_adapter(HERE / "adapters" / adapter_file)
        result = ing.ingest(HERE / "sample_data" / statement_file, adapter)
        f = feat.extract(result.transactions, result.currency)
        a = scoring.assess(f, result)
        assessments.append((name, adapter, result, f, a))

        rule("=")
        print(f"  {name}")
        print(f"  {adapter['bank_name']} · {adapter['country']} · {adapter['currency']}")
        rule()

        print(f"  INGEST     adapter={adapter['adapter_id']}  "
              f"format={adapter['amount_convention']}")
        print(f"             {len(result.transactions)} parsed, "
              f"{len(result.rejected)} rejected ({result.reject_rate:.1%})")
        print(f"             {f.history_days} days of history, "
              f"{f.months_observed} complete months")

        print()
        print(f"  REVENUE    {f.avg_monthly_revenue:>14,.0f} {f.currency} / month average")
        if f.excluded_inflows:
            print(f"             {f.excluded_inflows:>14,.0f} {f.currency} "
                  f"excluded (financing, not trading revenue)")

        print()
        print("  RISK FACTORS")
        for x in a.factors:
            if x.assessable:
                print(f"    {x.name:<20} {bar(x.points)}  {x.points:>5.1f}   {x.raw}")
            else:
                print(f"    {x.name:<20} {'n/a'.center(22)}  {'--':>5}   {x.raw}")

        print()
        print(f"    {'COMPOSITE SCORE':<20} {bar(a.score)}  {a.score:>5.1f}")

        if a.exceptions:
            print()
            print("  EXCEPTIONS (force human review)")
            for e in a.exceptions:
                print(f"    ! {e}")

        print()
        print(f"  DECISION   {BADGE[a.decision]}")
        if a.advance_amount:
            print(f"             advance up to {a.advance_amount:,.0f} {f.currency} "
                  f"at factor rate {a.factor_rate}")
        print(f"             {'fully automated' if a.automated else 'analyst review required'}")
        print()

    elapsed = time.perf_counter() - t0
    total = len(assessments)
    automated = sum(1 for *_, a in assessments if a.automated)
    rows = sum(len(r.transactions) for _, _, r, _, _ in assessments)

    rule("=")
    print("  PORTFOLIO SUMMARY".center(W))
    rule("=")
    print(f"  Applicants processed      {total}")
    print(f"  Transactions normalised   {rows:,}")
    print(f"  Straight-through decided  {automated}/{total}  ({automated/total:.0%})")
    print(f"  Routed to an analyst      {total - automated}/{total}")
    print(f"  Wall-clock time           {elapsed:.3f}s")
    print()
    print(f"  Currencies handled        AED, ZAR, SAR")
    print(f"  Date formats handled      DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY")
    print(f"  Header languages          English, Arabic")
    print(f"  Code changed per market   0 lines")
    rule("=")
    print()
    referred = [(n, a) for n, _, _, _, a in assessments if not a.automated]
    if referred:
        print("  Every applicant went from raw bank export to an explainable")
        print(f"  decision with no manual keying. {len(referred)} reached an analyst - and")
        print("  arrived with the reason already stated:")
        print()
        for name, a in referred:
            print(f"    {name}")
            for e in a.exceptions:
                print(f"      -> {e}")
        print()
        print("  Note what did NOT happen: it never guessed. Unrecognised income")
        print("  was excluded from the advance rather than assumed to be revenue,")
        print("  and the gap was reported as a named, fixable adapter rule.")
    else:
        print("  Every applicant went from raw bank export to a priced, explainable")
        print("  decision with no manual keying and no analyst involvement.")
    print()


if __name__ == "__main__":
    main()
