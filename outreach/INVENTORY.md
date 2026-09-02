# Inventory — everything built so far

Branch `claude/med-spa-outreach-audit-h1y4fp`, folder `outreach/`.
Every number below was computed from the files, not recalled.

---

## 1 · Leads

| | Count |
|---|---|
| Leads in the workbook | **804** |
| Cleared to send | **739** |
| Verify address before sending | 37 |
| Do not send — address on file is unusable | 22 |
| Hold — chain duplicate | 6 |

### Sendable leads by review volume

| Band | Leads |
|---|---|
| 150+ reviews | 287 |
| 100–149 | 104 |
| 50–99 | 152 |
| Under 50 | 196 |

801 of the 804 have a phone number. 53 carry Apollo firmographics (headcount, revenue,
location count) — the rest hit the Free-plan ceiling.

---

## 2 · Emails written

| | Count |
|---|---|
| **Hand-written first emails — one per lead** | **804** |
| Follow-ups (touches 2–5, segment-level) | 2,920 |
| **Total emails in the campaign** | **3,659** |
| Total words of hand-written first-touch copy | 33,256 |

First-email length: 8 words at the shortest, 40 median, 107 at the longest. The short ones
are deliberate — at the bottom of the list an owner reads their own inbox between clients
and anything longer gets deleted.

### Where the 804 live

| File | Emails |
|---|---|
| `handwritten_p4_001-055.md` | 55 |
| `handwritten_p4_056-120.md` | 65 |
| `handwritten_p4_121-162.md` | 42 |
| `handwritten_p2_001-040.md` | 40 |
| `handwritten_p2_041-078.md` | 38 |
| `handwritten_p3_tierB.md` | 59 |
| `handwritten_p5_chains.md` | 10 |
| `handwritten_p6_001-070.md` | 64 |
| `handwritten_p6_071-145.md` | 75 |
| `handwritten_p6_146-232.md` | 87 |
| `handwritten_p6_233-333.md` | 101 |
| `handwritten_p6_334-437.md` | 47 |
| `handwritten_p6_gated.md` | 63 |
| `p1_emails.md` | 11 |
| `p2_emails.md` | 18 |
| `core_small_emails.md` | 11 |
| `pool1_emails.md` | 18 |
| **Total** | **804** |

All 804 also sit in `MASTER_send_list.csv`, one row per lead, subject and body in their own
columns. That CSV is the working file; the markdown is for reading.

### The eight sequence segments

Follow-ups are segment-level, not individual — the directives require each follow-up to add
one new value proposition and never repeat the first email's argument.

| Segment | Sendable leads |
|---|---|
| coverage | 458 |
| early | 96 |
| multi-site | 55 |
| reviews | 52 |
| qualification | 49 |
| packages | 11 |
| wrong-fit *(one touch, no follow-ups)* | 9 |
| membership | 9 |

---

## 3 · Case studies: **zero**

Nothing to link. There are no customers, so there is no case study, no testimonial, no
client logo and no result to cite. Every asset here is deliberately built to work without
one:

- **Touch 3** is the slot the spec reserves for social proof. It carries verifiable product
  mechanics instead — bookings land as pending rather than confirmed, clinical questions get
  refused outright, patient data is de-identified before it reaches a model. All true of the
  system as built.
- **`REPLY_PLAYBOOK.md` §2.4** answers "who else uses this?" by saying you'd be early, there
  is no case study, you aren't going to invent one, and offering to show the build instead.
- **The call script** does the same thing out loud.

**The first signed client's real number replaces touch 3 across all eight campaigns.** That
is the single highest-leverage edit available to this campaign, and it is not available yet.

---

## 4 · Every file

### Ready to use

| File | What it is |
|---|---|
| `MASTER_send_list.csv` | 804 rows. Hand-written T1, four follow-ups, send status, segment, warnings, enrichment. **The working file.** |
| `REPLY_PLAYBOOK.md` | 14 reply types with response copy. Two blanks marked: pricing, BAA. |
| `SNOVIO_SETUP.md` | Campaign architecture, field mapping, settings, the 10/day capacity model, the domain decision. |
| `SPRINT_3_WEEKS.md` | The 21-day phone plan. What can and cannot hit that deadline. |
| `sprint_call_list.csv` | Top 60 with phone, timezone, UTC calling window, hook, opening line, outcome columns. |
| `followup_library.md` | Touches 2–5, hand-written, across eight segments. |

### Snov.io import set

| File | Rows |
|---|---|
| `snovio/campaign_coverage.csv` | 458 |
| `snovio/campaign_early.csv` | 96 |
| `snovio/campaign_multi_site.csv` | 55 |
| `snovio/campaign_reviews.csv` | 52 |
| `snovio/campaign_qualification.csv` | 49 |
| `snovio/campaign_packages.csv` | 11 |
| `snovio/campaign_membership.csv` | 9 |
| `snovio/campaign_wrong_fit.csv` | 9 |
| `snovio/daily_load_plan.csv` | 137 — the day-by-day ramp |
| `snovio/HOLD_do_not_import.csv` | 65 — **do not import** |

### Copy, for reading

The 17 markdown files listed in §2, plus `handwritten_p6_gated.md` which carries the 63
whose addresses are the problem rather than the businesses.

### Provenance — superseded, kept for audit

`medspa_qualified_leads.csv` · `medspa_qualified_leads_enriched.csv` ·
`pool2_leads_100plus.csv` · `pool3_leads_tierB.csv` · `pool4_ready162.csv` ·
`pool5_chain_locations.csv` · `pool6_remaining.csv` · the `.py` scripts that rebuild the
master from the markdown · `report.html`.

---

## 5 · The ten biggest leads

| Reviews | Rating | Business | City | Hook |
|---|---|---|---|---|
| 3,701 | 4.9 | Beauty Lab + Laser Murray | Salt Lake City, UT | mystery pricing |
| 2,327 | 5.0 | LUX MedSpa Brickell | Miami, FL | front desk |
| 1,938 | 4.7 | All Is Well Holistic Spa | Katy, TX | *partial fit — written as an honest non-pitch* |
| 1,556 | 4.9 | Elase Medical Spa | Salt Lake City, UT | location routing |
| 1,335 | 4.8 | Cosmetica | Boca Raton, FL | three people |
| 1,323 | 4.8 | Refresh – Aesthetics & Wellness | Jupiter, FL | weekend coverage |
| 1,134 | 4.8 | Couture Medical | Las Vegas, NV | clinical questions |
| 1,083 | 4.7 | Suddenly Slimmer Med Spa | Phoenix, AZ | dormant list |
| 1,062 | 5.0 | The Palm Medspa + Wellness | Orlando, FL | weekend calls |
| 1,000 | 4.6 | Kumi Laser Hair Removal | Katy, TX | bbb response |

---

## 6 · Status

| Item | State |
|---|---|
| 804 hand-written emails | **done** |
| Follow-up library, 8 segments | **done** |
| Master send list | **done** |
| Reply playbook | **done** |
| Snov.io campaign files | **done** |
| 3-week sprint plan + call list | **done** |
| `micronsai.com` warming | **in progress** |
| Verify 739 addresses (Snov.io verifier) | **not started** |
| Verify 37 addresses by hand | **not started** |
| Pricing decided | **not started — blocker** |
| BAA answer decided | **not started — blocker** |
| Google Postmaster Tools registered | **not started** |
| First client | **not yet** |

### Never done, on purpose

**The SEO audit.** Parked at your instruction, and it was blocked before that — the session's
network policy refuses page fetching for every domain in the list, and a control fetch of
`example.com` fails identically. No findings were invented to cover the gap.
