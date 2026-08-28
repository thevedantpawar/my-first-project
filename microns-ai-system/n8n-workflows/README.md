# n8n Workflows

Seven importable workflows. All of them are plain JSON — import through the UI
or with the bundled CLI helper.

| File | Trigger | What it does |
|---|---|---|
| `no_show_prevention.json` | Cron, hourly | Fetches upcoming appointments, sends 24h and 2h reminders |
| `reactivation_sequence.json` | Cron, daily 10 AM | Flags no-shows, texts a booking link, then a credit offer 3 days later |
| `review_request.json` | Webhook + 5-day wait | Asks for a review, drafts a reply for manager approval |
| `lead_qualification.json` | Webhook + cron, every 4h | Routes hot/warm/cold leads, escalates overdue follow-ups |
| `voice_handoff.json` | Webhook + cron, hourly | Alerts the clinical team on callbacks, escalates the 2-hour SLA |
| `missed_call_sms.json` | Webhook + 15-min wait | Texts a booking link the moment a call ends without a real conversation, nudges again if unused |
| `package_followup.json` | Cron, daily 9 AM | Rebooking nudge for package-based services (laser courses, injectable touch-ups) on their own cadence |

## What's new here vs. the original five

This repo already had a mature, HIPAA-aware med spa automation build before this
pass — five workflows, a FastAPI backend with encryption/audit/de-identification,
and a VAPI voice agent. None of the Slack webhooks were hardcoded; they already
read `$env.SLACK_WEBHOOK_URL`, set to continue on error. What this pass added:

- **`missed_call_sms.json`** (new) — nothing previously fired an SMS off an
  unanswered/abandoned call. The backend now flags a VAPI call as "missed" when
  it ends `abandoned` or `voicemail` (no booking, callback or FAQ answer
  happened), fires this workflow, sends a booking-link text within seconds, and
  nudges again at 15 minutes if the caller still hasn't booked.
- **`package_followup.json`** (new) — the existing dormancy check
  (`reactivation_sequence.json` / `dormant-patients`) is a general 45-day "we
  haven't seen you" nudge. It has no idea a patient is mid-way through a laser
  course or due for an injectable touch-up on a *shorter* cadence. This workflow
  adds that, driven by `PACKAGE_FOLLOWUP_DAYS` in the backend `.env`.
- **Per-workflow Slack variables** — `SLACK_WEBHOOK_URL_LEADS`,
  `SLACK_WEBHOOK_URL_REVIEWS`, `SLACK_WEBHOOK_URL_VOICE`,
  `SLACK_WEBHOOK_URL_RETENTION`. Each falls back to the shared
  `SLACK_WEBHOOK_URL` if unset, so nothing breaks if you only set one. This
  lets a clinic route hot-lead alerts to a `#sales` channel and callback SLA
  breaches to a `#clinical` channel without touching workflow JSON.
- **Cal.com as an optional booking adapter** — `BOOKING_SYSTEM_TYPE=calcom` in
  the backend, alongside the existing generic/Acuity/Square/Mindbody adapters.
  See "Why Cal.com is a backend adapter, not n8n nodes" below.

## Import

```bash
# From the repo root, with the stack running:
docker compose --profile import run --rm n8n-import
docker compose restart n8n
```

Or in the UI: open http://localhost:5678 → **Workflows** → **Import from File**,
and pick each JSON. Inside the container they are also mounted read-only at
`/workflows`.

After importing, open each workflow and click **Active** to enable it. They
import inactive on purpose — you do not want a reminder cron firing against a
half-configured clinic.

## Environment the workflows read

Set on the `n8n` service in `docker-compose.yml`:

| Variable | Purpose |
|---|---|
| `MICRONS_API_URL` | Backend base URL. `http://backend:8000` inside the compose network. |
| `INTERNAL_API_TOKEN` | Sent as `X-Internal-Token`. Must match the backend's. |
| `SLACK_WEBHOOK_URL` | Optional. Shared fallback for staff notifications. Nodes are set to continue on error, so leaving it unset degrades to silence rather than a failed run. |
| `SLACK_WEBHOOK_URL_LEADS` | Optional. `lead_qualification.json` only — falls back to `SLACK_WEBHOOK_URL`. |
| `SLACK_WEBHOOK_URL_REVIEWS` | Optional. `review_request.json` only — falls back to `SLACK_WEBHOOK_URL`. |
| `SLACK_WEBHOOK_URL_VOICE` | Optional. `voice_handoff.json` and `missed_call_sms.json` — falls back to `SLACK_WEBHOOK_URL`. |
| `SLACK_WEBHOOK_URL_RETENTION` | Optional. `package_followup.json` — falls back to `SLACK_WEBHOOK_URL`. |

`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is already set in `docker-compose.yml` —
without it, `$env.MICRONS_API_URL` resolves to nothing.

## Why the workflows call the backend instead of Twilio and OpenAI directly

The brief sketches Twilio and OpenAI nodes inside n8n. These workflows call
backend endpoints instead, and the reason is worth stating plainly:

1. **PHI containment.** For n8n to send a text it needs the patient's phone
   number and a rendered message body — both PHI, both then sitting in
   execution logs, workflow exports and any screenshot of the canvas. As
   built, n8n only ever handles UUIDs and booleans.
2. **Complete audit trail.** HIPAA §164.312(b) wants every PHI touch recorded.
   One send path in the backend means one place that writes the audit row. Two
   send paths means the trail is wrong the first time someone edits a
   workflow.
3. **Consent and idempotency.** `send_reminder` refuses to double-text on a
   re-run and honours `sms_consent` / `marketing_consent`. A Twilio node has no
   idea what consent is.

**If you want native nodes anyway** — say your clinic already runs Twilio
through n8n — replace each `Send … SMS` HTTP node with `n8n-nodes-base.twilio`,
add a backend endpoint that returns the phone number and rendered body for an
appointment id, and accept that PHI now lives in n8n's execution data. Set
`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` and put the n8n volume inside the same
encryption boundary as the database if you do.

## Why Cal.com is a backend adapter, not n8n nodes

A common pattern elsewhere is to put Cal.com/Twilio nodes directly inside n8n.
This build doesn't, for the same reason described above for Twilio and OpenAI:
n8n would need the patient's name, phone and chosen time to call Cal.com's API
directly, and that's PHI sitting in execution logs and workflow exports.

Instead, `voice_service.check_availability` / `book_appointment` call
`get_booking_service(db)`, which now supports `BOOKING_SYSTEM_TYPE=calcom`
alongside `generic` / `acuity` / `square` / `mindbody`
(`backend/app/services/booking_service.py`, `CalComBookingAdapter`). To use it:

1. In Cal.com, create one **event type per service category** (consult,
   injectable follow-up, laser session, ...).
2. Set `CALCOM_API_KEY` and `CALCOM_EVENT_TYPE_IDS` (a JSON map of
   `service -> event type id`, e.g. `{"botox":222222,"laser":444444}`) in the
   backend `.env`.
3. Set `BOOKING_SYSTEM_TYPE=calcom`.

Cal.com syncs to Google Calendar/Outlook on its own side — this adapter only
talks to Cal.com's API. It falls back to the built-in scheduler on any API
failure or missing config, same as the Acuity/Square adapters, and needs the
same sandbox verification before go-live (see the adapter's docstring —
Cal.com also requires an attendee email, which is synthesised from the phone
number when the patient hasn't given one).

## Notes on specific nodes

- **`Wait 5 Days`** (review request) and **`Wait 15 Minutes`** (missed call):
  n8n persists waits over 65 seconds and resumes them after a restart. If you
  would rather not hold executions open for days, disable the webhook branch
  in `review_request.json` and add a daily schedule that polls
  `GET /internal/reviews/pending` instead — the endpoint exists for exactly
  that. The 15-minute wait in `missed_call_sms.json` is short enough that this
  isn't usually worth doing.
- **`Post Reply to Google Business Profile`** ships **disabled**. Replying
  publicly to a review confirms the reviewer was a patient, which is a
  disclosure a human should authorise. Wire Google Business Profile OAuth and
  a real approval step before enabling it.
- **The "3 days later" branch** in `reactivation_sequence.json` is a query
  (`GET /internal/no-shows/pending-credit?days=3`) rather than a 3-day Wait
  node, so a container restart cannot strand half the queue.
- **`missed_call_sms.json`'s "missed call" definition.** The voice agent
  answers every call, so there's no classic unanswered-ring signal. "Missed"
  here means the call ended `abandoned` (caller hung up in under ~10 seconds,
  no real exchange) or `voicemail` — nobody actually talked to Bella and
  nothing was booked. A call that reached booking, a callback promise or an
  FAQ answer is left alone; it already has its own confirmation text.
- **`missed_call_sms.json`'s consent classification.** The first text (a
  direct reply to the caller's own inbound attempt, sent within minutes) is
  treated as transactional and does not wait on marketing consent. The 15-
  minute nudge is a second, unsolicited touch and stays gated on
  `marketing_consent` — which a first-time caller won't have yet, so in
  practice the nudge mostly fires for existing patients. Both classifications
  are judgment calls (`backend/app/services/sms_service.py`,
  `TRANSACTIONAL_TEMPLATES`) worth a look from the clinic's counsel before
  go-live, not settled law.
- **`package_followup.json`'s cadence.** `PACKAGE_FOLLOWUP_DAYS` in the
  backend `.env` maps service -> days since the last *completed* session
  (default: laser 28, botox 90, fillers 120, peel 30). A service with no entry
  is never nudged this way; it still gets the general 45-day dormancy check
  from `reactivation_sequence.json` / the retention dashboard. Adjust the
  numbers per clinic — these are reasonable defaults, not clinical guidance.
