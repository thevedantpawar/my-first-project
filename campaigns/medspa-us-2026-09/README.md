# US Med Spa Cold Outreach — 50 A+ leads

Five-touch sequence for 50 US med spa owners, built to
`COLD_EMAIL_DIRECTIVES.md`. Every email is hyper-personalized on that clinic's
own operating data, one CTA per email, and the only link is your booking link.

## Send it in three steps

```bash
# 1. Fill in the six placeholders
$EDITOR config.json          # booking_link + the five mailbox addresses

# 2. Render
python3 build.py             # exits 0 only when nothing is unfilled

# 3. Read before you send
$EDITOR out/preview.md       # all 50, rendered, in send order
```

Then upload `out/mailmeteor_send.csv` to Mailmeteor and map the template body to
the `{{T1 body}}` merge tag, subject to `{{T1 subject}}`. Each row already
contains its own fully-written email — Mailmeteor is only doing delivery and
scheduling, not assembly. Run one campaign per touch (five campaigns total),
each filtered to that touch's date column.

## Send schedule — built into the CSV

50 leads across 5 mailboxes, **2 per mailbox per day, 10 per day, 5 business
days**. Deliberately slow. Cold domains that open at 20/day/mailbox get filtered,
and you cannot personally handle 50 replies in one afternoon anyway.

| Touch | Offset | What it is |
|---|---|---|
| T1 | day 0 | The pitch. Four-step framework, booking link. |
| T2 | +3 business days | Short ping. One number restated. |
| T3 | +7 | How it books, plus the HIPAA architecture. |
| T4 | +12 | Argues against its own sale — where these fail at rollout. |
| T5 | +18 | Breakup. Reply 1, 2 or 3. No link. |

Send window is **08:00–10:00 in the prospect's timezone** — the `Send window`
column carries it per row (34 ET, 6 CT, 5 MT, 5 PT).

Full run: **2026-09-09 → 2026-10-09.**

### Send T1 and T2 only, at first

D10 says start at exactly two touches and earn the rest. You asked for five and
five are built — but launch T1+T2, wait for the T1 reply rate, then enable
T3–T5. Five touches on top of a sequence that isn't converting raises spam
complaints without raising replies.

## Two leads are on HOLD — do not send

| # | Business | Why |
|---|---|---|
| 34 | NSI Wellness | Email is `info@tolmanmedical.com` but the listing is NSI Wellness. Confirm the contact is current. |
| 36 | VIO Med Spa | Address is `queencreek@` against an Aventura listing — almost certainly the wrong franchise. Find the corporate ops owner. |

`build.py` prints both every run, and the `HOLD` column marks them in the CSV.
Filter `HOLD = ""` in Mailmeteor before sending. That drops you to 48.

## How the personalization works

Per D16/D17, AI does **not** write these emails from a bare prompt. The
structure is:

- `templates/t1.txt` — the fixed, human-authored four-step skeleton. Identical
  for all 50.
- `personalization.py` — two hand-written blocks per lead:
  - `hook` — Step 1. One or two sentences of pure observation from that
    clinic's own data. Never signals a sale.
  - `angle` — the specific thing that would be fixed for *that* clinic.
- `build.py` — renders one against the other and enforces the D7 red-flag gate.

So the personalization is per-clinic and hand-written; only the offer, the
proof and the CTA are constant — which is exactly what you want, because those
are the parts you A/B test across the whole list.

Personalization draws on the enrichment already in `source-leads.csv` (Google
rating, review count, headcount, locations, opening-hours gaps, segment,
per-lead warnings), which is dated 2026-09-08. It was **not** re-scraped for
this build. If a specific clinic's hours or rating have moved, correct the
`hook` in `personalization.py` and re-run.

## What each email deliberately does not do

- No stated price.
- No "we" — one person emailing one person.
- Never calls itself an AI, an agent or a bot. It describes what it does.
- No tracking pixels, no UTM parameters on the booking link, no HTML
  signature, no logo. **Send plain text.**
- Claims nothing about Skin Alive beyond "I built the booking automation
  running there" — no invented numbers.

## Files

```
config.json          the six values you fill in
source-leads.csv     the original 50-lead export, untouched
personalization.py   50 hand-written hooks + angles
templates/t1..t5.txt the fixed four-step skeletons
build.py             renders + QA gate
out/preview.md       all 50 rendered — read this before sending
out/mailmeteor_send.csv  upload this
qa/rubric-scores.md  D3 scoring, 6/7, and the two deliberate deviations
iteration-log.md     D14 tracker + what to change next
```
