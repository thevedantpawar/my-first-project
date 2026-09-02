# Follow-up library — touches 2 through 5

Touch 1 is hand-written per lead (804 of them, in the `handwritten_*.md` files). Touches 2–5
are **segment-level, not individual** — Level 2 personalization in the directives' terms.
That is deliberate: the directives say each follow-up must add *one new value proposition*
and never repeat the first email's argument, and the reliable way to do that at 741 sends
is a library keyed to the angle touch 1 used.

Cadence (from `references/follow-up-sequences.md`): day 0 · 3 · 7 · 14 · 21.
Send Tuesday–Thursday, 9–11am or 1–3pm in the prospect's local time. Never Monday morning,
never Friday afternoon.

**If a breakup email goes out, honour it.** No further contact from that address.

**One thing that is not in here: a case study.** The directives put social proof at touch 3.
There are no customers yet, so touch 3 substitutes verifiable product mechanics instead of an
invented result. The moment there is one real client with a real number, that number replaces
touch 3 everywhere — it is the single highest-leverage edit in this whole campaign.

---
## SEGMENT: coverage — touch 1 pitched after-hours answering
*(closures, dark days, front-desk misses — the largest segment)*

**T2 · day 3 · dormant patients**
Separate from the phones: patient bases go quiet without anyone noticing. A daily job finds everyone dormant past 45 days with nothing on the books and sends one message referencing what they actually had done — not a blast. No-shows get their own recovery path, because someone who missed an appointment converts far better than a cold lead. It runs whether or not anything else does.

**T3 · day 7 · how it books**
The part most vendors skip: every booking lands as *pending*, never confirmed. Your team keeps the last word on the calendar. And it refuses clinical questions outright — medications, contraindications, reactions get no automated answer, they route to a provider callback on a two-hour clock the system tracks. Patient data is encrypted per-field and de-identified before anything reaches a model; the orchestration layer only ever sees UUIDs.

**T4 · day 14 · the quiet leak**
The cost of a missed call isn't the call. It's that nobody logs it, so it never shows up in any report you read — the calendar looks fine and the gap is invisible. Reminders at 24 and 2 hours before each appointment, idempotent so nobody gets the same text twice, close the other half of the same leak. Two automations, one number to watch.

**T5 · day 21 · closing the loop**
I've sent a few notes and haven't heard back, so this is the last one. Reply with a number if it's easier: 1 — worth a conversation. 2 — not now, try again in three months. 3 — not interested, stop. No reply is fine too; I'll take that as a 3 and leave you alone.

---
## SEGMENT: reviews — touch 1 pitched review recovery
*(rating gaps, unanswered reviews)*

**T2 · day 3 · after hours**
The other half of a rating problem is the calls nobody answered. People don't leave a review for the practice they couldn't reach — they just book elsewhere, and your rating stays where it is while your calendar quietly thins. An agent that answers after hours, quotes real prices and books as pending covers that side.

**T3 · day 7 · how replies work**
On the review side specifically: nothing posts publicly on its own. Requests fire on a real treatment-completed event rather than a schedule, so nobody gets asked before they've been treated. Replies come back drafted, a human approves, and only then does anything go up. Public auto-posting is off by default and I'd leave it off.

**T4 · day 14 · the arithmetic**
At a few hundred reviews the average moves slowly, which is why the fix is volume of new ones rather than arguing with old ones. Asking every treated patient at the right moment is worth more than any single reply you write. The moment is the thing — a request sent two days later converts a fraction as well.

**T5 · day 21 · closing the loop**
Last note from me. Reply with a number if that's easier: 1 — worth a conversation. 2 — not now, three months. 3 — not interested. Silence works too, I'll read it as a 3. Good luck either way — the rating is fixable, with or without me.

---
## SEGMENT: qualification — touch 1 pitched lead triage
*(consult inquiries, mixed menus, small teams doing their own triage)*

**T2 · day 3 · after hours**
The other side of triage is the hours nobody's there. Qualification only helps if someone's awake to receive the answer, so the agent answers around the clock, quotes your real prices instead of "call us," and books qualified leads as pending for your team to confirm.

**T3 · day 7 · what the gates are**
Worth being precise about the screening, since this is the part that has to be right: six questions produce a 0–100 score and a hot/warm/cold routing. Two things sit *outside* the arithmetic entirely — pregnant or breastfeeding disqualifies to a medical callback no matter how good every other answer is, and blood thinners flag for provider approval without penalising the lead. Those are gates, not scores.

**T4 · day 14 · the quiet leak**
Meanwhile the patients you already treated go quiet. A daily job catches anyone dormant past 45 days with nothing booked and sends one message referencing their actual treatment history. Cheaper than any lead you'll buy this quarter, and it needs no triage at all.

**T5 · day 21 · closing the loop**
This is my last one. Reply with a number: 1 — worth a conversation. 2 — not now, three months. 3 — not interested, stop. No answer is an answer too; I won't write again.

---
## SEGMENT: membership — touch 1 pitched membership retention

**T2 · day 3 · dormant members**
The churn signal usually shows up before the cancellation: a member who stops booking. A daily job flags anyone past 45 days with nothing on the calendar and sends one message referencing what they actually had done. Catching it at day 45 rather than at the cancellation email is most of the retention work.

**T3 · day 7 · how it books**
Bookings land as pending, never confirmed — your team keeps the calendar. Clinical questions get no automated answer at all; they route to a provider callback on a tracked two-hour clock. Patient data is encrypted per-field and de-identified before any of it reaches a model.

**T4 · day 14 · the no-show half**
Members no-show more than one-off patients do, because they've already paid and the appointment feels free. Reminders at 24 and 2 hours, idempotent so nobody gets doubled up, are the cheapest fix available for that specific behaviour.

**T5 · day 21 · closing the loop**
Last note. Reply with a number if it's easier: 1 — worth a conversation. 2 — not now, three months. 3 — not interested. Silence is fine, I'll stop either way.

---
## SEGMENT: packages — touch 1 pitched laser/package abandonment

**T2 · day 3 · the reminder half**
Package abandonment and no-shows are the same leak from different ends. Reminders at 24 and 2 hours before each session, idempotent so nobody gets the same message twice, keep people in the series they already paid for.

**T3 · day 7 · how it books**
Rebookings land as pending, never confirmed, so your team keeps the last word on the laser calendar. Clinical questions — settings, healing, contraindications — get no automated answer; those route to a provider callback on a tracked clock.

**T4 · day 14 · session three**
The abandonment point is consistent enough to schedule around: session three of six is where people stop. Nobody follows up because nobody's job it is. That's a cron job, not a hire.

**T5 · day 21 · closing the loop**
My last one. Reply with a number: 1 — worth a conversation. 2 — not now, three months. 3 — not interested. No reply is fine; I'll assume the timing's wrong and leave it.

---
## SEGMENT: multi-site — touch 1 offered a single-location pilot
*(chains, franchises, networks)*

**T2 · day 3 · what a pilot measures**
To be concrete about the pilot: one location, after-hours only, measured against that same site's prior eight weeks. Recovered bookings against cost. If it doesn't clear, that's a clean no and nobody has to argue about it. Nothing touches the other sites.

**T3 · day 7 · how it books**
Per-location hours, per-location pricing, and every booking lands as pending rather than confirmed so each site's front desk keeps its own calendar. Clinical questions route to a provider callback on a tracked two-hour clock. Patient data is de-identified before it reaches a model and the orchestration layer only ever sees UUIDs — which is the part your compliance people will ask about first.

**T4 · day 14 · the rollout question**
The honest version: most of these fail at rollout, not at pilot. What makes the difference is whether each site's hours and pricing live in one place someone actually maintains. Worth knowing whether that exists at your network before anyone signs anything.

**T5 · day 21 · closing the loop**
Last note from me, and I'd rather send one than seven. Reply with a number: 1 — worth a conversation. 2 — not now, three months. 3 — not interested, and I'll stop writing to your locations entirely. Silence I'll read as a 3.

---
## SEGMENT: early — under ~30 reviews, one automation only

**T2 · day 3 · the first fifty**
One thing worth doing early, whether or not it's with me: make sure the first fifty patients each get asked for a review at the right moment. Those fifty set the number every later patient reads before they call you. The moment matters more than the wording — a request two days late converts a fraction as well.

**T3 · day 7 · how it books**
Short version of the mechanics: bookings land as pending, never confirmed, so you keep the calendar. Nothing clinical gets an automated answer. Patient data is encrypted per-field. That's the whole surface area — deliberately small, because at your stage a big system is the wrong purchase.

**T4 · day 14 · not yet, probably**
Being straight: at your size the full stack is more than the business can absorb, and I'd rather say that than sell it. One automation, the one that maps to whatever is actually costing you — usually the phone. If none of it is costing you anything yet, that's a fine answer and worth knowing.

**T5 · day 21 · closing the loop**
Last one. Reply with a number: 1 — worth a conversation. 2 — check back when we're bigger. 3 — not interested. No reply is fine.

---
## SEGMENT: wrong-fit — touch 1 said so honestly
**One touch only. No follow-ups.** These were written as honest non-pitches; following up on
a "this probably isn't for you" turns a courtesy into spam and earns a complaint. If they
reply, that's a real conversation. If not, they stay on the list and never hear from us again.
