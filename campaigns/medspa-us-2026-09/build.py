#!/usr/bin/env python3
"""Render the Mailmeteor send file from templates/ + personalization.py.

    python3 build.py

Writes out/mailmeteor_send.csv (upload this) and out/preview.md (read this first).
"""
import csv, json, re, sys
from datetime import date, timedelta
from pathlib import Path

import personalization as P

ROOT = Path(__file__).parent
CFG = json.loads((ROOT / "config.json").read_text())
TOUCHES = ["T1", "T2", "T3", "T4", "T5"]


def business_days_after(start: date, n: int) -> date:
    d, added = start, 0
    while added < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            added += 1
    return d


def load_template(name: str) -> str:
    return (ROOT / "templates" / f"{name.lower()}.txt").read_text().strip()


OFFER = {
    True:  "One location, thirty days, measured against that same location's prior "
           "eight weeks. If the recovered bookings don't clear the cost, that's a "
           "clean no and I'll say so first.",
    False: "Thirty days, measured against your own prior eight weeks. If the "
           "recovered bookings don't clear the cost, that's a clean no and I'll "
           "say so first.",
}
MEASURE = {
    True:  "on one location, against its own prior eight weeks",
    False: "against your own prior eight weeks",
}


def render(touch: str, lead: dict, row: dict) -> str:
    multi = bool(lead.get("multi"))
    body = load_template(touch).format(
        offer=OFFER[multi],
        measure=MEASURE[multi],
        hook=lead["hook"],
        angle=lead["angle"],
        business_casual=lead["casual"],
        sender_first_name=CFG["sender_first_name"],
        proof_client=CFG["proof_client"],
        proof_descriptor=CFG["proof_descriptor"],
        booking_link=CFG["booking_link"],
    )
    if touch not in CFG["booking_link_in_touches"]:
        # Drop the CTA line entirely rather than leaving a dangling link.
        body = "\n".join(
            l for l in body.splitlines() if CFG["booking_link"] not in l
        )
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def words(text: str) -> int:
    return len(re.findall(r"\S+", re.sub(r"https?://\S+", "", text)))


def main() -> int:
    rows = list(csv.DictReader((ROOT / "source-leads.csv").open()))
    start = date.fromisoformat(CFG["campaign_start"])
    per_day = CFG["sends_per_mailbox_per_day"] * len(CFG["mailbox_addresses"])

    out_rows, preview, problems = [], [], []

    for i, row in enumerate(rows):
        rank = int(row["Campaign Rank"])
        lead = P.LEADS[rank]
        day_index = i // per_day
        send_date = business_days_after(start, day_index) if day_index else start

        rec = {
            "Rank": rank,
            "Business": row["Business"],
            "Email": row["Email"],
            "City": row["City"],
            "ST": row["ST"],
            "Mailbox": row["Mailbox"],
            "From": CFG["mailbox_addresses"][row["Mailbox"]],
            "Prospect TZ": row["Prospect TZ"],
            "Send window": CFG["send_window_local"] + " " + row["Prospect TZ"],
            "Segment": row["Segment"],
            "HOLD": lead.get("hold", ""),
        }

        for t in TOUCHES:
            offset = CFG["touch_offsets_business_days"][t]
            subject = (
                lead["subject"]
                if t == "T1"
                else P.FOLLOWUP_SUBJECTS[t][rank % len(P.FOLLOWUP_SUBJECTS[t])]
            )
            body = render(t, lead, row)
            rec[f"{t} date"] = business_days_after(send_date, offset).isoformat()
            rec[f"{t} subject"] = subject
            rec[f"{t} body"] = body
            if t == "T1":
                rec["T1 words"] = words(body)

        # QA gates (D7 red flags).
        b1 = rec["T1 body"]
        if re.search(r"\bwe\b|\bour team\b", b1, re.I):
            problems.append(f'rank {rank}: corporate "we" in T1')
        if re.search(r"\bAI\b|\bbot\b|\bchatbot\b", b1):
            problems.append(f"rank {rank}: robot self-branding in T1")
        if re.search(r"\$\d", b1):
            problems.append(f"rank {rank}: price stated in T1")
        if len(re.findall(r"https?://", b1)) > 1:
            problems.append(f"rank {rank}: more than one link in T1")
        if rec["T1 words"] > 165:
            problems.append(f'rank {rank}: T1 is {rec["T1 words"]} words (cap 165)')

        out_rows.append(rec)
        preview.append(rec)

    (ROOT / "out").mkdir(exist_ok=True)
    with (ROOT / "out" / "mailmeteor_send.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0]))
        w.writeheader()
        w.writerows(out_rows)

    with (ROOT / "out" / "preview.md").open("w") as fh:
        fh.write("# Rendered campaign — read before sending\n\n")
        fh.write(f"Generated from config.json (start {CFG['campaign_start']}, "
                 f"{per_day}/day across {len(CFG['mailbox_addresses'])} mailboxes).\n\n")
        for r in preview:
            fh.write(f"\n---\n\n## {r['Rank']}. {r['Business']} — {r['City']}, {r['ST']}\n\n")
            fh.write(f"`{r['Email']}` · mailbox {r['Mailbox']} · {r['Send window']} · "
                     f"{r['Segment']} · T1 {r['T1 words']} words\n")
            if r["HOLD"]:
                fh.write(f"\n> **HOLD — do not send.** {r['HOLD']}\n")
            for t in TOUCHES:
                fh.write(f"\n**{t} · {r[f'{t} date']} · subject: {r[f'{t} subject']}**\n\n")
                fh.write("```\n" + r[f"{t} body"] + "\n```\n")

    unfilled = sorted(k for k, v in CFG.items()
                      if not k.startswith("_") and isinstance(v, str)
                      and "PLACEHOLDER" in v)
    unfilled += sorted(f"mailbox_addresses.{k}"
                       for k, v in CFG["mailbox_addresses"].items()
                       if "PLACEHOLDER" in v)

    holds = [r for r in out_rows if r["HOLD"]]
    print(f"Wrote out/mailmeteor_send.csv and out/preview.md — {len(out_rows)} leads.")
    print(f"T1 length: min {min(r['T1 words'] for r in out_rows)}, "
          f"max {max(r['T1 words'] for r in out_rows)}, "
          f"mean {sum(r['T1 words'] for r in out_rows)//len(out_rows)} words.")
    print(f"Send window: {out_rows[0]['T1 date']} → {out_rows[-1]['T5 date']}.")
    if holds:
        print(f"\n{len(holds)} lead(s) flagged HOLD — resolve before sending:")
        for r in holds:
            print(f"  {r['Rank']}. {r['Business']}: {r['HOLD']}")
    if unfilled:
        print("\nNOT SENDABLE YET — fill these in config.json and re-run:")
        for k in unfilled:
            print("  " + k)
    if problems:
        print("\nQA FAILURES:")
        for p in problems:
            print("  " + p)
        return 1
    print("\nQA: all D7 red-flag checks passed.")
    return 1 if unfilled else 0


if __name__ == "__main__":
    sys.exit(main())
