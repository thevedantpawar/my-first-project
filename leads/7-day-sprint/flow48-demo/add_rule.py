#!/usr/bin/env python3
"""
The live moment.

The Saudi applicant was referred because 42% of its income arrived through
HyperPay - a processor no rule covered. This is what fixing that looks
like: one entry in a JSON file, no code, no deploy.

    python3 add_rule.py hyperpay
    python3 run.py

Run with --undo to put it back for the next demo.
"""
import json
import sys
from pathlib import Path

RULES = Path(__file__).parent / "rules" / "income_rules.json"


def main():
    args = [a for a in sys.argv[1:] if a != "--undo"]
    undo = "--undo" in sys.argv

    with open(RULES, encoding="utf-8") as f:
        rules = json.load(f)

    patterns = rules["revenue_inflow"]

    if undo:
        removed = [p for p in patterns if p == "hyperpay"]
        rules["revenue_inflow"] = [p for p in patterns if p != "hyperpay"]
        print(f"  removed {len(removed)} rule(s) - back to the starting state")
    else:
        if not args:
            print("usage: python3 add_rule.py <pattern>   (e.g. hyperpay)")
            return 1
        for pattern in args:
            p = pattern.lower()
            if p in patterns:
                print(f"  '{p}' already recognised as revenue")
            else:
                patterns.append(p)
                print(f"  added '{p}' to revenue_inflow")

    with open(RULES, "w", encoding="utf-8") as f:
        json.dump(rules, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"  {RULES.relative_to(Path.cwd())} updated - no code changed, no deploy")
    print("  now re-run: python3 run.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
