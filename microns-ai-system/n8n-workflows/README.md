# n8n Workflows

Five importable workflows. All of them are plain JSON — import through the UI
or with the bundled CLI helper.

| File | Trigger | What it does |
|---|---|---|
| `no_show_prevention.json` | Cron, hourly | Fetches upcoming appointments, sends 24h and 2h reminders |
| `reactivation_sequence.json` | Cron, daily 10 AM | Flags no-shows, texts a booking link, then a credit offer 3 days later |
| `review_request.json` | Webhook + 5-day wait | Asks for a review, drafts a reply for manager approval |
| `lead_qualification.json` | Webhook + cron, every 4h | Routes hot/warm/cold leads, escalates overdue follow-ups |
| `voice_handoff.json` | Webhook + cron, hourly | Alerts the clinical team on callbacks, escalates the 2-hour SLA |

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
| `SLACK_WEBHOOK_URL` | Optional. Staff notifications. Nodes are set to continue on error, so leaving it unset degrades to silence rather than a failed run. |

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

## Notes on specific nodes

- **`Wait 5 Days`** (review request): n8n persists waits over 65 seconds and
  resumes them after a restart. If you would rather not hold executions open
  for days, disable the webhook branch and add a daily schedule that polls
  `GET /internal/reviews/pending` instead — the endpoint exists for exactly
  that.
- **`Post Reply to Google Business Profile`** ships **disabled**. Replying
  publicly to a review confirms the reviewer was a patient, which is a
  disclosure a human should authorise. Wire Google Business Profile OAuth and
  a real approval step before enabling it.
- **The "3 days later" branch** in `reactivation_sequence.json` is a query
  (`GET /internal/no-shows/pending-credit?days=3`) rather than a 3-day Wait
  node, so a container restart cannot strand half the queue.
