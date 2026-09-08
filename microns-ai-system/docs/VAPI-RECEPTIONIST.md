# The AI receptionist

How to build the voice agent in VAPI and point it at this engine.

Everything here matches `app/routers/webhooks.py` and `app/services/voice_service.py`
as they actually are. If you change a tool name or a parameter, change it in both
places — a tool VAPI calls by a name the engine does not know gets
"Let me get someone from the team to help with that", which sounds like the
agent being cautious rather than a typo.

---

## 1. One server URL, not three

```
https://<your-engine-host>/webhooks/vapi
```

That single endpoint dispatches on `message.type`. Use it for the assistant's
Server URL **and** for every tool's server URL.

This matters because VAPI allows one server URL per assistant, and the engine
also exposes `/voice/inbound`, `/voice/action` and `/voice/end` separately.
Those are the engine's own API — useful for `curl` and for tests. They are not
what you give VAPI, because VAPI cannot split `end-of-call-report` and
`tool-calls` across different addresses.

**Server messages to enable:** `tool-calls`, `end-of-call-report`. Add
`assistant-request` only if you are doing the dynamic-greeting setup in §5.
Everything else is answered `{"status": "ignored"}` and costs nothing.

## 2. The secret

Set a **Server URL Secret** on the assistant. VAPI sends it as `X-Vapi-Secret`
on every server request, and the engine compares it in constant time.

Then set the same value on the engine:

```
VAPI_WEBHOOK_SECRET=<the same string>
```

**This is not optional in production.** Without it the engine returns `503` to
every voice webhook, because the alternative is that anyone who finds the URL
can book, cancel, and read appointment times. In development an unset secret
logs a warning and allows the call, so you can exercise the flow with `curl`.

Requests are rate limited to 120/minute before the comparison happens — an
unlimited guessing rate is what makes a shared secret weak, and constant-time
comparison only removes the timing signal.

## 3. The system prompt

Paste this as the assistant's system prompt. The `{{...}}` variables are
injected by the engine at call time (§5); if you are not using
`assistant-request`, replace them with literals.

```text
You are Bella, the receptionist at {{CLINIC_NAME}}, a medical aesthetics clinic.
You are answering the phone. Speak the way a warm, competent front-desk person
speaks: short sentences, no lists, no jargon, one question at a time.

You are talking to {{PATIENT_FIRST_NAME}} if that is not empty. Returning
patient: {{IS_RETURNING_PATIENT}}.

## What you can actually do

Use your tools. Never invent a time, a price, or a confirmation.

- Someone wants an appointment -> check_availability, offer the times it
  returns, then book_appointment once they pick one.
- Someone asks what something costs -> get_pricing. Say the range it gives you
  and that the exact figure depends on the consultation.
- Someone asks about their existing appointment -> lookup_appointment.
- Someone wants to move or cancel one -> reschedule_appointment or
  cancel_appointment.
- General question about the clinic -> answer_faq.
- Anything clinical, or anything you cannot resolve -> request_callback.

If a tool gives you a sentence back, say that sentence or something very close
to it. It was written to be spoken.

## The hard rules

1. **You are not a clinician.** Do not answer whether a treatment is safe for
   someone, whether it will interact with a medication or a condition, whether
   they are a suitable candidate, what dose they need, or what to do about a
   side effect or a complication. Every one of those is request_callback with
   reason "medical_question". Say: "That's one for our nurse — let me get them
   to call you back." Then do it. Do not soften this because the caller
   insists; a caller pushing harder is a reason to hand off sooner.

2. **Urgency overrides everything.** If a caller describes vision changes,
   severe pain, skin turning white or grey, difficulty breathing, or anything
   that sounds like it is getting worse quickly, tell them to seek medical care
   now and call request_callback with priority "urgent". Do not book them an
   appointment instead.

3. **Never confirm what you have not booked.** Appointments are created as
   pending, and the front desk confirms them. Say "I've got that held for you
   and the front desk will confirm shortly" — not "you're all booked".

4. **Do not read back medical history.** You may confirm a name, a phone
   number, and an appointment time. Nothing else, even if the caller asks, and
   even if they claim to be the patient. If someone wants their records, that
   is a callback.

5. **One caller, one number.** Do not discuss an appointment with someone
   calling about another person. Offer a callback to the number on file.

6. **Do not guess at identity.** If lookup_appointment finds nothing, ask for
   the name it is booked under. Do not speculate.

## Style

Confirm the important things by repeating them once: the service, the day, the
time, and the phone number for the confirmation text. Spell nothing out
letter-by-letter unless asked. If you did not catch something, say so plainly
and ask again — do not guess at a date.

If the caller wants to book online instead, give them {{BOOKING_URL}}.
If they want a human right now, take a callback; do not promise a transfer.

End by saying what happens next in one sentence.
```

## 4. Tools

Create each of these as a function tool, server URL set to the endpoint in §1.
Names and parameter names must match exactly.

| Tool | Required | Optional |
|---|---|---|
| `check_availability` | — | `service`, `days_ahead` (default 7), `limit` (default 3) |
| `book_appointment` | `slot_start` | `service`, `patient_phone`, `patient_name` |
| `lookup_appointment` | — | `patient_phone` |
| `reschedule_appointment` | `new_slot_start` | `appointment_id`, `patient_phone` |
| `cancel_appointment` | — | `appointment_id`, `patient_phone` |
| `get_pricing` | — | `service` |
| `answer_faq` | `question` | — |
| `request_callback` | — | `reason`, `callback_number`, `priority`, `patient_name` |

`service` is matched loosely — "tox", "wrinkle relaxer" and "botox" all resolve
to `botox`; "lip filler" to `fillers`. The canonical set is `botox`, `fillers`,
`laser`, `facial`, `peel`, `consultation`, and anything unrecognised becomes
`consultation` rather than failing.

Dates go in as natural ISO (`2026-09-15T14:00:00`). The engine parses loosely,
but an unparseable date returns "which day and time would you like?" rather
than booking something wrong.

**The phone number is usually optional because the engine already has it.**
When a tool omits `patient_phone`, the engine falls back to the number the call
came from. Ask for a number only when the caller wants the confirmation sent
somewhere else.

Two schemas worth copying verbatim, since they are the ones agents get wrong:

```json
{
  "name": "check_availability",
  "description": "Find open appointment slots. Call this before offering any time.",
  "parameters": {
    "type": "object",
    "properties": {
      "service": {
        "type": "string",
        "description": "botox, fillers, laser, facial, peel, or consultation"
      },
      "days_ahead": {"type": "integer", "description": "How far ahead to look. Default 7."},
      "limit": {"type": "integer", "description": "How many slots to return. Default 3."}
    },
    "required": []
  }
}
```

```json
{
  "name": "request_callback",
  "description": "Hand off to a human. Use for anything clinical, or anything you cannot resolve.",
  "parameters": {
    "type": "object",
    "properties": {
      "reason": {
        "type": "string",
        "description": "medical_question, complaint, complex_booking, or other"
      },
      "priority": {"type": "string", "enum": ["normal", "urgent"]},
      "callback_number": {"type": "string", "description": "Only if different from the caller's number."},
      "patient_name": {"type": "string"}
    },
    "required": []
  }
}
```

## 5. The personalised greeting, and why it is optional

The engine can greet a returning patient by name. That requires the
`assistant-request` flow, which VAPI uses **only when the phone number has no
assistant attached** — if you attach the assistant to the number directly,
VAPI never asks, and the caller hears the assistant's static first message.

To use it:

1. Leave the phone number's assistant unset in VAPI.
2. Enable the `assistant-request` server message.
3. Set `VAPI_ASSISTANT_ID` on the engine to the assistant's id.

The engine then answers with `assistantId` and `assistantOverrides` carrying
`firstMessage` and these variables: `CLINIC_NAME`, `CLINIC_PHONE`,
`PATIENT_FIRST_NAME`, `IS_RETURNING_PATIENT`, `BOOKING_URL`.

If `VAPI_ASSISTANT_ID` is not set and VAPI asks anyway, the engine declines with
a spoken error and logs which variable is missing, rather than dropping the call
silently. The call is still recorded — a missed call from a misconfigured number
is still a lead.

**The simpler setup is fine.** Attach the assistant to the number, skip
`assistant-request`, and accept a generic greeting. Everything else — booking,
pricing, lookups, callbacks, the transcript — works identically.

## 6. Checking it works

```bash
curl -X POST https://<host>/webhooks/vapi \
  -H "Content-Type: application/json" \
  -H "X-Vapi-Secret: $VAPI_WEBHOOK_SECRET" \
  -d '{"message":{"type":"tool-calls","call":{"id":"test_1"},
       "toolCalls":[{"id":"tc_1","function":{"name":"get_pricing",
       "arguments":{"service":"botox"}}}]}}'
```

You should get a `results` array whose `result` is a speakable sentence with a
price in it. If you get `503`, `VAPI_WEBHOOK_SECRET` is unset on the engine. If
you get `401`, the two secrets do not match.

After a real call, check the console's voice section: the transcript is stored
**encrypted**, with the duration and outcome in clear. The transcript is PHI —
it is not written to logs, and neither is the caller's number.

## 7. What will not work on day one

- **Confirmation texts.** Booking composes an SMS, audits it, and discards it
  until Twilio credentials and A2P 10DLC carrier registration are in place.
  Registration takes weeks. The appointment is still created; the caller just
  does not get the text, so tell the front desk to confirm by phone until then.
- **The practice calendar.** Without Google Calendar credentials, appointments
  live in the engine's own scheduler and do not appear on the clinic's calendar.
- **Fluent phrasing.** With `LLM_PROVIDER=none` the engine's own sentences come
  from a deterministic rule engine. VAPI's model still speaks naturally; the
  strings it is handed are just plainer. Enabling a vendor means arranging a BAA
  first — the Gemini Developer API is not covered by one.
