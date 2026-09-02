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

## 3 · Capacity at 10/day per mailbox

**Your cap: 5 mailboxes × 10 cold sends/day = 50/day.** Warm-up traffic runs on top of that,
not inside it.

The thing to hold onto: **that 50 is total sends, not new leads.** Every lead you start costs
five emails over three weeks, so at steady state you can only *begin* about 10 new leads a day.

Ramp, starting the day warm-up finishes:

| | Per mailbox | Total/day | New leads/day |
|---|---|---|---|
| Week 1 | 5 | 25 | ~5 |
| Week 2 | 7 | 35 | ~7 |
| Week 3 onward | 10 | 50 | ~10 |

Simulated against the real 739 leads and their per-segment step counts:

| Scope | Days | New-lead starts done | Last email sent |
|---|---|---|---|
| **All 739** | Mon–Fri | week 13 | **~17 weeks** |
| All 739 | Tue–Thu | week 18 | ~22 weeks |
| 543 with 50+ reviews | Mon–Fri | week 10 | ~13 weeks |
| Top 350 by rank | Mon–Fri | week 6 | ~10 weeks |

**Mon–Fri, all 739.** Tue–Thu is the better-replying window, but it costs five extra weeks
here and there is no capacity headroom to make up. At 50/day the constraint is the cap, not
the calendar.

### The scope call is yours

17 weeks is a long campaign. The tail is thin: **196 of the 739 have under 50 reviews** and
they sit at the bottom of the rank order for a reason. Cutting to the 543 with 50+ reviews
saves four weeks and drops the leads least likely to reply.

I would run all 739 anyway — the copy is written, the marginal cost is time rather than
money, and week 14 onward is only ~40 sends a day. But if you want the campaign to conclude
sooner, cut at 50 reviews and stop. Say the word and I will re-cut the files.

### The daily load plan

`snovio/daily_load_plan.csv` — 137 rows, one per campaign per send day. Each row says the
date, which campaign, how many prospects to add, and which `microns_rank` range they cover.

- First send: **Mon 28 Sep 2026** (assumes warm-up completes ~4 weeks from now)
- Last new lead started: **1 Jan 2027**
- Last email in the whole campaign: **22 Jan 2027**

Peak weekly volume is 289 emails, in week 7. Nothing ever exceeds the 50/day cap.

Work it top to bottom. Each morning, open the campaigns named for that date and add the
prospects in the listed rank range. Ten minutes a day.

---

## 4 · Snov.io settings that matter

| Setting | Value | Why |
|---|---|---|
| Sending limit per mailbox | 5/day wk1 → 7 wk2 → **10 and hold** | Your cap |
| Open tracking | **Off** | The tracking pixel is a spam signal and open rates are unreliable post-MPP anyway |
| Link tracking | **Off** for touch 1 | A rewritten link on a first cold email costs more deliverability than the data is worth |
| Email format | **Plain text** | HTML templates on cold outreach read as marketing |
| Stop on reply | **On** | Non-negotiable — a follow-up after a reply is the worst thing this campaign can do |
| Stop on bounce | **On** | |
| Unsubscribe link | **On** | CAN-SPAM |
| Physical address | In the signature of every step | CAN-SPAM. It has to be a real address |
| Warm-up | **Keep running** for the whole 17 weeks | Warm-up is not a phase you finish |
| Sending window | 9–11am and 1–3pm, prospect's local time | From the directives |

Mailbox rotation: let Snov.io rotate across all five. Don't pin a campaign to one mailbox —
that concentrates the reputation risk you bought five mailboxes to spread.

---

## 4b · Which domain you send from — decide this before warm-up finishes

Three options, and they are not close.

| Option | Protects main domain | Inbox placement | Cost | Delay |
|---|---|---|---|---|
| Main domain (current) | ✗ no | good | $0 | none |
| `micronsai.online` | ✓ yes | **poor** | $0 | ~4 wks restart |
| **A `.com` variant** | ✓ yes | good | **~$12/yr** | ~4 wks restart |

**Decided: `micronsai.com`.** The delay is identical to using `.online`, and the twelve
dollars buys back everything `.online` costs you.

### Why not `.online`

`.online` is one of the cheap TLDs — alongside `.xyz`, `.top`, `.click`, `.icu` — that
spam operations buy in bulk because they cost pennies. Filters know this. A brand-new
`.online` domain starts from a worse baseline at Gmail and Outlook than a brand-new `.com`
does, and no amount of warm-up fully closes that gap.

There is also the human half. The recipients here are practice owners and office managers at
medical clinics. A vendor writing from `something.online` reads as less established than the
same vendor writing from `something.com` — and this campaign is already asking them to be
somebody's first customer. Don't add a second reason to doubt you.

Owning it already is not a reason to use it. Twelve dollars is less than one hour of the time
you'd spend recovering from a deliverability problem.

### What to buy

`micronsai.com`. It needs a real website — a cold email from a domain that resolves to
nothing is a spam signal, and a prospect who Googles you finds a parking page. A redirect to
your main site is enough; a one-page site is better.

### What switching actually costs

The warm-up running on your five current mailboxes is per-mailbox and per-domain. Moving
domains restarts it. Realistically: **buy and configure the domain this week, put a site on
it, then 3–4 weeks of warm-up.** Roughly the same first-send date you already have, since
warm-up is running anyway — you just switch which mailboxes are warming.

On the Workspace side, a second domain can be added to the account you already have. Users
on it consume licences, so check what five more seats costs you before committing; a domain
alias is the cheaper route if you're willing to send from aliases rather than separate users.
Confirm the billing in your own admin console rather than taking my word for it.

### If you stay on the main domain anyway

Everything below still applies — and applies harder, because a reputation problem there
reaches your invoices and your client mail, not just this campaign.

### Verify all 739 addresses before a single send

This is the highest-value item on the list regardless of which domain you choose.

These addresses came out of a scraped workbook and **not one has been validated.** I already
found 22 that are definitely dead — an image filename, a GIF filename, `john@doe.com`, two
typo TLDs. Those were the ones visible by reading. There will be more among the other 717
that only a verifier catches.

Bounce rate is the fastest way to damage a domain. Snov.io includes an email verifier. **Run
all 739 through it, remove everything invalid or risky, and only then start.** Budget an
afternoon. If it kills more than ~10% of the list, tell me — that changes the timeline and I
will re-cut the daily plan.

### Register the sending domain in Google Postmaster Tools

Free, ten minutes, and the only way to see your real Gmail spam rate rather than guessing.
**Above 0.10% means stop immediately** — Google's own threshold, shown to you directly.

### One complaint is the stop signal, not a data point

Across 739 addresses, 0.1% is less than one complaint. Suppress and pause, don't note it
and continue.

**What works in your favour either way:** Snov.io sends through the Google Workspace
mailboxes themselves, not a third-party relay. SPF, DKIM and DMARC stay aligned on whichever
domain you choose — no alignment breakage, no "via" header in Gmail. Confirm all three are
published and passing before wave 1.

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

> **Running in parallel:** `SPRINT_3_WEEKS.md` is a phone-and-manual-email sprint against
> the top 60 leads, aimed at a client inside 21 days. It needs no warm-up and does not delay
> anything here. This document is the machine; that one is the shortcut.

---

## 6 · What is still blocking

1. **`micronsai.com` live with a site on it**, five mailboxes pointed at it, warm-up
   restarted. Everything else in this doc waits on that.
2. **Verify the list.** §4b. Nothing sends until this is done.
3. **Pricing.** §2.2 of the reply playbook is a blank. The first person who replies
   "how much?" gets a non-answer until you fill it in.
4. **The BAA answer.** §2.6, same. Every serious medical buyer asks. "I'll check" costs the deal.
5. **37 addresses to verify by hand** — the ones where the domain doesn't match the business
   name, which a verifier will pass because the mailbox is real but wrong. ~2 minutes each.
   Montclair Rejuvenation Center is 1,398 reviews and sits at the top of that list.
6. **Google Postmaster Tools** registered, and SPF/DKIM/DMARC confirmed passing.

---

## 7 · Sequence

1. **Set up `micronsai.com`, put a site on it, create the five mailboxes there.** Then let
   warm-up run its full 3–4 weeks. Don't cut it short because the copy is ready.
2. **Verify all 739 through Snov.io's verifier.** Remove invalid and risky. Tell me the
   survivor count if it drops more than ~10%.
3. **Register Google Postmaster Tools**, confirm SPF/DKIM/DMARC pass.
4. **Build the 8 campaigns.** Steps and delays per §2, settings per §4.
5. **Import 5 test rows, check the line breaks**, send yourself one. Read it in a real inbox
   before 739 people do.
6. **Week 1: 25 emails a day, coverage campaign only**, top of `microns_rank`. One campaign,
   one week, so a deliverability problem shows up on 25 leads and not on 458.
7. **End of week 1, check three numbers:** bounce rate, Postmaster spam rate, complaints.
   Bounces above 4%, spam rate above 0.10%, or one complaint — **stop.** Anything else,
   continue to the daily load plan.
8. **Weeks 2–17:** work `daily_load_plan.csv` top to bottom. Ten minutes each morning.
