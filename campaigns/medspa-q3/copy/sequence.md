# Med Spa Outbound Sequence — Microns AI

Merge variables come from `output/send_tier_a.csv` / `send_tier_b.csv`:
`{{first_line}}` · `{{display_name}}` · `{{city}}` · `{{calendly}}` · `{{site}}`

Two placeholders MUST be filled before send:
- `{{site}}` — the agency URL (not present anywhere in the repo)
- `{{proof}}` — a real result from a real clinic. Left blank on purpose. Do not invent one.

Rules applied throughout: no greeting prefix, no em dashes, one CTA per email,
opt-out is action-conditional (silence keeps the cadence running).

---

## Email 1 — Day 0

**Subject line options (pick one, lowercase, internal-looking):**
1. `sunday calls`
2. `front desk`
3. `after hours`

**Body**

```
{{first_line}}

The calls that go unanswered at an aesthetic practice tend to be the expensive
ones. Someone decides on Botox at 7pm, hits voicemail, and books with whoever
answers first the next morning.

We build a voice agent that answers your line around the clock. It holds the
slot on your calendar, handles pricing questions, and hands anything clinical
to your staff instead of trying to answer it.

{{proof}}

Worth seeing how it would handle your call flow?

Vedant
{{site}}
```

---

## Email 2 — Day 3 (threaded, no subject line)

```
One more angle on this.

The after-hours piece is usually what people focus on, but the bigger number is
weekday calls during treatments. Injector is in a room, phone rings, nobody
picks up. That call rarely comes back.

The agent answers those too, so a full treatment room stops costing you the
next booking.

Would that be useful to see?

Vedant
```

---

## Email 3 — Day 7 (threaded)

```
Rather than describe it, I can send a two minute recording of the agent taking
a pricing call and moving an appointment.

No call needed to hear it. Say the word and I will send it over.

If it is useful after that, my calendar is here: {{calendly}}

Vedant
```

---

## Email 4 — Day 12 (threaded, close-out)

```
I have not heard back, so I will assume the timing is off rather than the idea.

If the front desk side of {{display_name}} is already handled, say "not for us"
and I will step out of your inbox.

If it is not, 15 minutes is all I would need: {{calendly}}

Vedant
{{site}}
```

---

## CAN-SPAM footer (required on every email)

```
Microns AI, [STREET ADDRESS], [CITY, STATE ZIP]
Reply "unsubscribe" and I will remove you from this list.
```

The physical address is a legal requirement for commercial email in the US.
It is missing and must be supplied before the first send.
