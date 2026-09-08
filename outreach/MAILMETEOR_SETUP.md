# Mailmeteor — sending the 50, today

**You are not writing 50 emails. They are already written.** All 50 bodies are unique,
hand-written, and sitting in a column. The job today is loading them, not composing them.

That distinction is the whole answer to "how long will this take."

---

## 1 · The one idea that makes this work

Most people use a mail merge like this:

```
Hi {{First name}}, I noticed {{Company}} is closed on {{Day}}...
```

One template, fields swapped. That is exactly what you said you don't want, and prospects
spot it instantly.

**Do the opposite.** Put the entire unique email in a column, and make the template nothing
but the placeholder:

```
{{Body_html}}
```

Subject line: `{{Subject}}`

Mailmeteor merges each row separately, so all 50 recipients get a completely different
email — different opening, different argument, different close — from a single send. There
is no template. The "template" is a pointer.

This is the only way to send 50 genuinely different emails without typing 50 emails.

---

## 2 · Why five merges, not one

**Mailmeteor sends through the Gmail account it's connected to.** One account per merge.

You have 5 mailboxes × 10 emails. That is **five separate merges**, each from its own
Google account. There is no way around this and it is also what you want — it spreads the
volume exactly as planned.

Files are already split for you:

| File | Rows | From |
|---|---|---|
| `mailmeteor/day1_mailbox1.csv` | 10 | mailbox 1 |
| `mailmeteor/day1_mailbox2.csv` | 10 | mailbox 2 |
| `mailmeteor/day1_mailbox3.csv` | 10 | mailbox 3 |
| `mailmeteor/day1_mailbox4.csv` | 10 | mailbox 4 |
| `mailmeteor/day1_mailbox5.csv` | 10 | mailbox 5 |

### Columns

| Column | What it's for |
|---|---|
| `Email` | recipient |
| `Subject` | merge into the subject field |
| **`Body_html`** | **merge into the body — this is the email** |
| `Body_text` | same copy, plain text, for reading and checking |
| `Business` `City` `Rating` `Reviews` `Employees` `Segment` | context while you review |
| `Coverage gap` `Warnings` | what the email is built on, and anything to check |
| `Status` `Sent at` `Opened` `Replied` `Notes` | yours to fill as replies come in |

`Body_html` is already wrapped in `<p>` tags, so paragraph breaks survive the merge.
Bodies run 3–5 paragraphs. **This matters** — a raw text cell collapses into one block of
90 words, which reads like a wall and gets deleted.

---

## 3 · Steps

**Once, before the first send (~35 min)**

1. **Set the signature on all five mailboxes** — Gmail settings, not Mailmeteor. Same block
   on each, with the sending address swapped:
   ```
   --
   [YOUR NAME]
   Microns · micronsai.com
   [STREET ADDRESS, CITY, STATE ZIP]
   ```
   The physical address is not optional. CAN-SPAM requires it on every commercial email.
2. **Confirm each mailbox's daily quota** in Mailmeteor. Ten a day is far under any plan
   limit, but check what your plan reports rather than assuming.
3. **Turn open tracking ON, click tracking OFF.** You want to know if it was opened. A
   rewritten link on a first cold email costs more deliverability than the click data is
   worth — and these emails contain no links anyway.

**Per mailbox (~5 min each, 25 min for all five)**

4. Open a new Google Sheet, **File → Import → Upload** `day1_mailbox1.csv`.
5. Open Mailmeteor from the sheet (Extensions → Mailmeteor), connect **mailbox 1**.
6. Create the template:
   - Subject: `{{Subject}}`
   - Body: `{{Body_html}}` — and switch the editor to HTML mode so the tags render as
     paragraphs rather than printing literally.
7. **Send one test to yourself first.** Check: paragraphs render, no stray `<p>`, signature
   appears, no tracking pixel warning in Gmail.
8. Send, or schedule for the prospect's window.
9. Repeat for mailboxes 2–5.

**Before you press send (~25 min)**

10. **Read all 50 bodies once.** 30 seconds each. You are checking three things: does the
    fact in the first line look right, is there anything you'd be embarrassed to have said,
    does it sound like you. **Thirty-six of the 50 carry a `Warnings` value** — read those twice.

---

## 4 · Timing, honestly

| | Time |
|---|---|
| **Today (first run, everything from scratch)** | **~85 min** |
| — signatures + settings, once only | 35 min |
| — five sheets and five merges | 25 min |
| — reading the 50 bodies | 25 min |
| **Days 2–6 (setup already done)** | **~35 min each** |
| — import 5 new sheets, point the same template at them | 15 min |
| — read the 50 new bodies | 20 min |

**Total for the whole 6-day, 300-email campaign: about 4½ hours of your time.**

For comparison: writing 50 genuinely researched emails by hand is 8–12 minutes each once
you include looking the clinic up. That is **7–10 hours per day, 45–60 hours across the
campaign.** The research and writing is what's already done.

---

## 5 · Send times

The sheet carries `Prospect TZ`. Aim for 9–11am or 1–3pm **in their timezone**, Tuesday to
Thursday. Today's 50 span four zones, so if you're sending in one sitting, schedule rather
than send-now:

| Their zone | Their 9–11am is |
|---|---|
| ET | 13:00–15:00 UTC |
| CT | 14:00–16:00 UTC |
| MT | 15:00–17:00 UTC |
| PT | 16:00–18:00 UTC |

Mailmeteor schedules per merge, not per row — so either split each mailbox's ten by zone,
or pick one window and accept that some land off-peak. At ten emails a mailbox, one window
is fine. Don't over-engineer this on day one.

---

## 6 · Follow-ups — the one thing Mailmeteor won't do for you

**Mailmeteor is a mail merge, not a sequencer.** It sends one email per row per run. It does
not automatically fire T2 three days later to whoever didn't reply.

So the follow-ups are manual re-merges:

| Touch | When | How |
|---|---|---|
| T2 | day 3 | Filter the sheet to rows with no reply, merge `{{T2_body}}` |
| T3 | day 7 | Same, `{{T3_body}}` |
| T4 | day 14 | Same |
| T5 | day 21 | Same, then stop permanently |

Each re-merge is ~10 minutes. The T2–T5 copy already exists per lead in
`campaign_300.csv`; tell me when you want those columns added to the Mailmeteor sheets and
I'll generate them.

**Update the `Replied` column the same day a reply arrives.** If you don't, someone who
answered gets a follow-up, and that is the single most damaging thing this campaign can do.

If multi-step sequencing matters more than tracking, Snov.io does it automatically and the
import files for it are already built in `snovio/c300/`. Mailmeteor gives you better
per-email visibility; Snov.io gives you automation. Running day 1 through Mailmeteor to see
what happens is a reasonable way to decide.

---

## 7 · Before you press send — final check

- [ ] Signature with a real physical address on all five mailboxes
- [ ] Open tracking on, click tracking off
- [ ] One test email sent to yourself from each mailbox, read in a real inbox
- [ ] All 50 bodies read once
- [ ] The 36 rows with warnings read twice
- [ ] A plan for who watches the five inboxes for replies today

**Reply within four hours or the reply is wasted.** That is the part of this that no tool
does for you.
