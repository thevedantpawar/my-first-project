# Test plan — verifying the system before a demo

Run these in order. Each section is self-contained; skip a section if that
integration isn't configured yet (the system degrades gracefully — see the
"Without X" note in each). Everything below assumes `docker compose up` is
running and workflows are imported and **Active** (see the top-level README's
Quick Start).

Shell variables used throughout:

```bash
API=http://localhost:8000
STAFF_TOKEN=<your STAFF_API_TOKEN>
INTERNAL_TOKEN=<your INTERNAL_API_TOKEN>
VAPI_SECRET=<your VAPI_WEBHOOK_SECRET>
```

---

## 0. Smoke test — is anything wired up at all?

```bash
curl -s $API/health | python3 -m json.tool
```

Check the `integrations` block honestly reflects what you've configured
(`openai`, `twilio`, `vapi`, `calendly` — `calcom` is inferred from
`BOOKING_SYSTEM_TYPE` + `CALCOM_API_KEY`, not shown separately yet). Read
`warnings` — anything listed there will silently degrade the workflows below,
not fail loudly.

```bash
cd backend && pytest -q   # expect 142 passed, 0 failed
```

If this doesn't pass clean, nothing below is trustworthy. Fix it first.

---

## 1. Lead Qualification (existing)

```bash
curl -s -X POST $API/leads/qualify -H "Content-Type: application/json" -d '{
  "treatment_interest": "botox",
  "previous_experience": true,
  "budget_range": "1000-2000",
  "timeline": "asap",
  "is_pregnant": false,
  "blood_thinner": false,
  "phone": "+15551112222"
}' | python3 -m json.tool
```

**Expect:** `temperature: "hot"`, `score >= 80`, `next_action:
"auto_book_consultation"`. This has been run against a live instance of this
build and returns `score: 93`. Check n8n's execution list for `Microns — D.
Lead Qualification Follow-Up` — it should have fired within a second or two.
If `SLACK_WEBHOOK_URL_LEADS` (or the shared `SLACK_WEBHOOK_URL`) is set, a
Slack message should land.

**Safety gate to verify separately:** resend with `"is_pregnant": true` —
expect `score: 0`, disqualified, routed to callback, regardless of every
other answer. This gate cannot be overridden by budget or timeline; confirm
that in the response.

---

## 2. Appointment Booking Agent (voice)

### Without a live VAPI call

```bash
curl -s -X POST $API/voice/inbound -H "X-Vapi-Secret: $VAPI_SECRET" -H "Content-Type: application/json" -d '{
  "message": {"type": "assistant-request", "call": {"id": "test_call_1", "customer": {"number": "+15553334444"}}}
}' | python3 -m json.tool
```

**Expect:** `assistant_overrides.variableValues.CLINIC_TRANSFER_NUMBER` is
populated (empty string means `CLINIC_TRANSFER_NUMBER` isn't set — fix before
demoing the emergency-transfer flow in section 4).

```bash
curl -s -X POST $API/voice/action -H "X-Vapi-Secret: $VAPI_SECRET" -H "Content-Type: application/json" -d '{
  "message": {"type": "tool-calls", "call": {"id": "test_call_1"},
    "toolCalls": [{"id": "tc1", "function": {"name": "check_availability", "arguments": "{\"service\":\"botox\"}"}}]}
}' | python3 -m json.tool
```

**Expect:** three ISO-8601 slots inside clinic hours, `speech` reads them
back naturally. Pick one and call `book_appointment` the same way — confirm
the created appointment shows `status: "pending"` (front-desk confirms, the
agent never auto-confirms) via
`curl -s $API/retention/dashboard -H "X-Staff-Token: $STAFF_TOKEN"`.

### With a live VAPI call (before pitching this as a demo)

1. Point a VAPI assistant's `serverUrl` at your public backend URL (ngrok for
   local testing) and paste `voice-agent/system-prompts/booking-agent.txt`
   into the assistant's system prompt.
2. Call the assistant's phone number. Book a real appointment end to end.
   Confirm the confirmation SMS arrives (or, without Twilio, that
   `docker compose logs backend` shows `SMS[dry-run]`).
3. Say "actually can you move it" — confirm the reschedule tool fires and the
   reminder timestamps reset (`reminder_24h_sent_at` back to null in the DB).

### Cal.com specifically (if `BOOKING_SYSTEM_TYPE=calcom`)

Before wiring it into a live call: confirm the adapter round-trips against a
Cal.com **sandbox** event type first —

```bash
curl -s -X POST $API/voice/action -H "X-Vapi-Secret: $VAPI_SECRET" -H "Content-Type: application/json" -d '{
  "message": {"type": "tool-calls", "call": {"id": "test_call_calcom"},
    "toolCalls": [{"id": "tc1", "function": {"name": "check_availability", "arguments": "{\"service\":\"consultation\"}"}}]}
}'
```

If Cal.com returns slots, they should differ from the internal scheduler's
even-half-hour pattern (Cal.com respects the event type's own buffers). If
they look identical to the generic adapter's output, the adapter silently
fell back — check `docker compose logs backend` for `Cal.com slots lookup
failed`.

---

## 3. Missed Call → Instant SMS → Booking (new)

This can't be triggered by a real "nobody answered" call, because the AI
answers every call. It fires when a call ends `abandoned` (hung up in the
first few seconds) or `voicemail`.

```bash
curl -s -X POST $API/voice/inbound -H "X-Vapi-Secret: $VAPI_SECRET" -H "Content-Type: application/json" -d '{
  "message": {"type": "assistant-request", "call": {"id": "test_missed_1", "customer": {"number": "+15556667777"}}}
}' > /dev/null

curl -s -X POST $API/voice/end -H "X-Vapi-Secret: $VAPI_SECRET" -H "Content-Type: application/json" -d '{
  "message": {"type": "end-of-call-report", "call": {"id": "test_missed_1"},
    "endedReason": "customer-ended-call", "durationSeconds": 3}
}' | python3 -m json.tool
```

**Expect:** `outcome: "abandoned"`. Within a few seconds, check n8n's
execution list for `Microns — F. Missed Call Instant SMS` — it should have a
run in progress (sitting in the 15-minute Wait node). Check
`docker compose logs backend` for `SMS[dry-run] template=missed_call_sms` (or
a real Twilio send).

**To verify the 15-minute nudge without waiting 15 minutes:** open the
running execution in the n8n UI and use "Resume" on the Wait node, or
temporarily edit a copy of the workflow's Wait node to `10 seconds` for
testing only — do not ship that change.

**To verify the nudge correctly skips when the caller books:** re-run the
above, then before the 15 minutes are up, book an appointment for
`+15556667777` through `check_availability` / `book_appointment` — the nudge
should skip with `already_booked` (check the n8n execution's output, or the
backend logs for `status": "skipped"`).

---

## 4. After-Hours / Emergency Capture

**This is the one to rehearse out loud before a demo, not just curl.** Call
the assistant (or `/voice/action` with `answer_faq`) and say something that
sounds like an active reaction — e.g. *"my lip has been swelling since I left
and it's getting worse."*

**Expect:** the agent stops, says the transfer line, and calls `transfer_call`
— **not** `request_callback`. If `CLINIC_TRANSFER_NUMBER` isn't set, this will
either fail or transfer to a blank destination; verify in a VAPI sandbox call,
not just by reading the config.

Then ask a hypothetical: *"can I get filler if I'm on blood thinners?"* —
**Expect:** `request_callback` (2-hour promise), not a live transfer. This
distinction is the whole point of section 4 — verify both directions, not just
one.

```bash
curl -s "$API/internal/voice/pending-callbacks?hours=1" -H "X-Internal-Token: $INTERNAL_TOKEN"
```

Confirm the callback shows up, and that `Microns — E. Voice Agent Handoff &
Callback SLA` fired a Slack alert (`SLACK_WEBHOOK_URL_VOICE` or the shared
webhook).

---

## 5. Review Request & Response

```bash
curl -s -X POST $API/webhooks/treatment-completed -H "Content-Type: application/json" -d '{
  "appointment_id": "<a real completed appointment id>"
}'
```

**Expect:** `Microns — C. Review Request & Response Drafting` starts a 5-day
Wait. To test the SMS branch without waiting 5 days, poll the endpoint the
workflow's alternate branch uses instead:

```bash
curl -s "$API/internal/reviews/pending?delay_days=0" -H "X-Internal-Token: $INTERNAL_TOKEN"
```

Then submit a review and confirm a draft reply is generated (falls back to a
template without an OpenAI key) and requires manual approval:

```bash
curl -s -X POST $API/internal/reviews/received -H "X-Internal-Token: $INTERNAL_TOKEN" -H "Content-Type: application/json" -d '{
  "appointment_id": "<same id>", "rating": 2, "review_text": "Long wait, but the results are great."
}' | python3 -m json.tool
```

**Expect:** `requires_human_approval: true` always. Confirm
`Post Reply to Google Business Profile` stays **disabled** in the n8n UI —
this should never auto-post.

---

## 6. Treatment Plan / Package Follow-up (new)

```bash
curl -s "$API/internal/packages/pending-followup" -H "X-Internal-Token: $INTERNAL_TOKEN" | python3 -m json.tool
```

With no completed laser/botox/fillers/peel appointments older than
`PACKAGE_FOLLOWUP_DAYS`, this returns `[]` — that's correct, not broken. To
force a real row: complete an appointment via
`/webhooks/treatment-completed`, then in the DB backdate its `completed_at`
past the cadence for that service (there's no API for this on purpose — it's
a real elapsed-time condition, not a state a clinic should be able to fake
through the API). Confirm:

- The nudge is marketing-consent gated (`patient.marketing_consent`) —
  flip it on the test patient if it doesn't send.
- Running `pending-followup` again after a send returns `[]` for that
  appointment (idempotent).
- `Microns — G. Package & Treatment-Plan Follow-Up`'s Slack summary
  (`SLACK_WEBHOOK_URL_RETENTION`) only fires when at least one nudge went out.

---

## 7. Slack Notifications

All four workflows that notify Slack are set to **continue on error** — an
unset or wrong webhook degrades to silence, not a failed run. Verify that
explicitly:

```bash
# temporarily point SLACK_WEBHOOK_URL_LEADS at an invalid URL, re-run section 1
```

**Expect:** the n8n execution still completes (green), the SMS/CRM steps
still ran, and only the Slack node shows red in the execution detail view.
That's the workflow behaving correctly, not a bug to chase.

Then set real webhook URLs (ask the clinic which channel each should land
in — `#leads`, `#reviews`, `#front-desk`, `#retention` is a reasonable
starting split) and re-run sections 1, 3, 4 and 6 to confirm messages land in
the right channels.

---

## Before pitching this as a demo

- [ ] `pytest -q` is green (142 passed)
- [ ] All 7 workflows show **Active** in the n8n UI
- [ ] `CLINIC_TRANSFER_NUMBER` is set and section 4's live-transfer path has
      been rehearsed on an actual phone call, not just curl
- [ ] Real Slack webhook(s) are set and section 7's channel routing is correct
- [ ] If demoing Cal.com: a sandbox event type exists per service and section
      2's Cal.com check has been run
- [ ] Real client details are in `voice-agent/price-list.json` and the
      `CLINIC_*` variables in `.env` — nothing in this repo's defaults
      (Radiance Med Spa, placeholder prices) should reach a real prospect
