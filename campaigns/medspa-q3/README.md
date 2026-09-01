# Med Spa Outbound Campaign — Q3

Source list: 1,048 US med spa rows (Google Maps / Apify scrape).

## Contents

| Path | What it is |
|---|---|
| `scripts/enrich_leads.py` | Cleaning, tiering, dedupe, signal derivation, first-line generation, spam QA |
| `copy/sequence.md` | The 4-email sequence with merge variables |
| `output/send_tier_a.csv` | 540 leads, email domain matches clinic site. Send first |
| `output/send_tier_b.csv` | 160 leads on free providers. Send second |
| `output/review_tier_c.csv` | 104 leads needing manual verification before send |
| `output/suppress.csv` | 244 rows that must never be sent to |
| `output/enriched_all.csv` | All 1,048 rows with tier, signal and copy |

## Re-run

```bash
python3 scripts/enrich_leads.py <raw.csv> output
```

## Two blockers before any send

1. `{{site}}` — agency URL, not present in this repo
2. `{{proof}}` — a real client result. Deliberately left blank rather than invented

## Why `has_online_booking` is ignored

The column reads "No" on 1,042 of 1,048 rows. Live checks of a sample found
online booking present in every case. Building the campaign on that claim would
open each email with a verifiably false statement.
