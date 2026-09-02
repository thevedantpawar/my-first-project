# Snov.io setup — 5 mailboxes, 739 leads, 3,659 emails

Everything here follows from one fact: **touch 1 is different for all 739 leads.** A normal
drip campaign has one template per step. Ours has 739 first emails and 4 shared follow-ups
per segment. That inverts how the campaign gets built.

---

## 1 · The architecture — read this first

**Touch 1 goes in as prospect data, not as a template.**

Each campaign's first email body is literally the variable `{{microns_body}}`, and its
subject is `{{microns_subject}}`. The hand-written copy rides in on the CSV, one row per
lead. Snov.io renders it per prospect at send time.

**Touches 2–5 are real templates**, because they're segment-level by design. That's why
there are eight campaigns instead of one — each segment's follow-ups say something
different, and a drip campaign can only hold one set of steps.

```
Campaign "coverage"  →  step 1: {{microns_subject}} / {{microns_body}}   ← 458 unique emails
                        step 2 (+3d):  dormant patients      ← one template
                        step 3 (+4d):  how it books          ← one template
                        step 4 (+7d):  the quiet leak        ← one template
                        step 5 (+7d):  closing the loop      ← one template
```

Note the step delays are **gaps between steps**, not days from start: 3, 4, 7, 7 produces
day 0 / 3 / 7 / 14 / 21. Check which convention Snov.io uses in your account before you
trust the dates.

---

## 2 · The eight campaigns

Import files are in `outreach/snovio/`. Follow-up copy for each step is in
`outreach/followup_library.md`, under the matching `## SEGMENT:` heading.

| Campaign | Leads | File | Steps |
|---|---|---|---|
| coverage | 458 | `campaign_coverage.csv` | 5 |
| early | 96 | `campaign_early.csv` | 5 |
| multi-site | 55 | `campaign_multi_site.csv` | 5 |
| reviews | 52 | `campaign_reviews.csv` | 5 |
| qualification | 49 | `campaign_qualification.csv` | 5 |
| packages | 11 | `campaign_packages.csv` | 5 |
| membership | 9 | `campaign_membership.csv` | 5 |
| **wrong-fit** | **9** | `campaign_wrong_fit.csv` | **1 — no follow-ups** |

The wrong-fit nine were written as honest "this probably isn't for you" notes. Adding
follow-ups to them turns a courtesy into spam. Build that campaign with one step and stop.

`HOLD_do_not_import.csv` holds the other 65 leads — 37 whose address needs verifying, 22
whose address is unusable, 6 chain duplicates. **Do not import that file.** It exists so
the copy isn't lost; move rows into a campaign file as you fix each address.

### CSV columns → Snov.io fields

| Column | Map to |
|---|---|
| `Email` | Email |
| `Company` | Company name |
| `City` / `State` / `Country` | Location fields |
| `Website` / `Phone` | Site / Phone |
| `microns_subject` | **custom field** |
| `microns_body` | **custom field** |
| `microns_rank` / `microns_rating` / `microns_reviews` | custom fields (reference only) |

**Verify on the first import that line breaks inside `microns_body` survive.** Bodies are
multi-paragraph. Import 5 rows into a test list, open the preview, and look at the
paragraph breaks before you import 458. If they collapse, that's a blocker — tell me and
I'll re-emit the bodies with explicit break markers or push them through the API instead.

There are no first names. The copy was written with no greeting line on purpose — a wrong
"Hi there" reads worse than none. **Do not add a fallback greeting.**

---

## 3 · Capacity — this is the correction to my earlier schedule

My previous plan said 20→40 emails a day across 22 waves, 8 Sep – 27 Oct. **That counted
only first emails.** Once follow-ups are in flight, every lead you start today costs five
sends over the next three weeks, so steady-state daily volume is roughly five times the
new-lead rate. The old schedule would have hit ~200 emails/day at steady state — 40 per
mailbox — which is above where cold outreach on Google Workspace stays safe.

Corrected model, 5 mailboxes at 25 cold sends/day each (warm-up traffic runs on top of
this, not inside it):

| | Total capacity | New leads you can start |
|---|---|---|
| Week 1 | 10/mailbox = 50/day | ~10/day |
| Week 2 | 15/mailbox = 75/day | ~15/day |
| Week 3 | 20/mailbox = 100/day | ~20/day |
| Week 4+ | 25/mailbox = 125/day | ~25/day |

Two schedules, both simulated against the real 739 leads and their per-segment step counts:

| Plan | New-lead starts finish | All sending done | Avg/day |
|---|---|---|---|
| **Tue–Thu only** | week 7 | ~11 weeks | 49 |
| **Mon–Fri** | week 5 | ~9 weeks | 63 |

Tue–Thu is the better-replying window; Mon–Fri finishes two weeks sooner. **Recommendation:
Tue–Thu for the first 200 leads, then open to Mon–Fri.** The top of the list is where reply
rate is worth protecting; the tail is where speed is worth more.

Week-by-week volume on the Mon–Fri plan: 301 · 431 · 575 · 669 · 589 · 530 · 282 · 182 · 100.

### Loading the campaigns

Don't dump 458 prospects into the coverage campaign on day one — Snov.io will start them
all and blow through the daily cap. Load in weekly batches sized to the table above, in
`microns_rank` order (the CSVs are already sorted that way, best leads first).

---

## 4 · Snov.io settings that matter

| Setting | Value | Why |
|---|---|---|
| Sending limit per mailbox | Start 10/day, +5/week, cap 25 | The whole capacity model above |
| Open tracking | **Off** | The tracking pixel is a spam signal and open rates are unreliable post-MPP anyway |
| Link tracking | **Off** for touch 1 | A rewritten link on a first cold email costs more deliverability than the data is worth |
| Email format | **Plain text** | HTML templates on cold outreach read as marketing |
| Stop on reply | **On** | Non-negotiable — a follow-up after a reply is the worst thing this campaign can do |
| Stop on bounce | **On** | |
| Unsubscribe link | **On** | CAN-SPAM |
| Physical address | In the signature of every step | CAN-SPAM. It has to be a real address |
| Warm-up | **Keep running** during the campaign | Warm-up is not a one-time phase |
| Sending window | 9–11am and 1–3pm, prospect's local time | From the directives |

Mailbox rotation: let Snov.io rotate across all five. Don't pin a campaign to one mailbox —
that concentrates the reputation risk you bought five mailboxes to spread.

---

## 5 · Where replies actually land

**Replies go to the Google Workspace inbox, not to Snov.io.** Snov.io sees the reply well
enough to stop the sequence, but the conversation is yours to have from the mailbox.

Across five mailboxes that's five inboxes to watch. Two ways to handle it:

1. **Forward all five into one inbox** and reply from the address the prospect wrote to.
   Simplest, and it makes the four-hour response standard achievable.
2. Watch all five. Workable at this volume but easy to drop one.

Whichever you pick, `outreach/REPLY_PLAYBOOK.md` has response copy for all fourteen reply
types. The four-hour rule in it is the part that matters most.

---

## 6 · What is still blocking

1. **Pricing.** §2.2 of the playbook is a blank. The first person who replies "how much?"
   gets a non-answer until you fill it in.
2. **The BAA answer.** §2.6, same. Every serious medical buyer asks. "I'll check" costs the deal.
3. **Which domain the 5 mailboxes are on.** If they're on the domain the business runs on,
   this campaign is putting that domain's reputation at risk. Cold outreach belongs on a
   separate domain that can be burned without consequence.
4. **37 addresses to verify**, ~2 minutes each. Montclair Rejuvenation Center is 1,398
   reviews and sits at the top of that list.

---

## 7 · Sequence

1. Let the warm-up run its full 3–4 weeks. Don't cut it short because the copy is ready.
2. Build the 8 campaigns. Steps and delays per §2, settings per §4.
3. Import 5 test rows, check the line breaks, send yourself one. Read it in a real inbox.
4. Week 1: load ~50 leads into `coverage` only, top of `microns_rank`. One campaign, one
   week, so a deliverability problem shows up on 50 leads and not on 458.
5. Check bounce rate at the end of week 1. **Above 4% — stop and re-verify the list.**
   One spam complaint — stop.
6. Week 2 onward: add the other campaigns, ramp per §3.
