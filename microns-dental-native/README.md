# Microns Dental Native

A HIPAA-aware AI automation system for a dental practice, built around
**Google Calendar as the primary trigger source** instead of a generic
cron-plus-spreadsheet architecture: appointments ending or getting booked on
Google Calendar drive hygiene recall, treatment-plan follow-up, review
requests, and insurance verification; Twilio drives after-hours emergency
capture and lead qualification; VAPI drives the phone.

There are **two independent implementations** of the same six modules in
this repo — pick one, or run both against different practices:

- **`n8n-workflows/`** — six importable n8n workflows that talk to Google/
  Twilio/Calendly/Gmail directly, with state in n8n Data Tables. Nothing to
  deploy beyond n8n itself; the fastest way to see this running and the
  easiest to edit visually.
- **`backend/`** — a FastAPI + PostgreSQL service with field-level PHI
  encryption, an immutable HIPAA audit trail, a de-identification layer in
  front of every OpenAI call, and a VAPI voice agent. The better fit if you
  want persistent, queryable, audited state and a REST API a real
  PMS/EHR can call into.

Both are documented in this README; `n8n-workflows/README.md` covers the
n8n-specific import steps.

## Contents

```
microns-dental-native/
├── docker-compose.yml
├── .env.example
├── backend/                    # FastAPI + PostgreSQL + Google/Twilio/OpenAI services
├── n8n-workflows/               # 6 self-contained n8n workflows (see its own README)
├── voice-agent/                 # VAPI assistant config + 3 system prompts + price list
└── frontend/chat-widget/        # Embeddable lead-qualification chat widget
```

## The six modules

| # | Module | Trigger | Where it lives |
|---|---|---|---|
| 1 | Hygiene recall (30/60/90/120-day drip) | Google Calendar (event ended / created) | `backend/app/services/retention_service.py`, `n8n-workflows/hygiene_recall_google_calendar.json` |
| 2 | Treatment-plan follow-up (1/3/7/14/30-day, Gmail-approved) | Google Calendar | `treatment_plan_service.py`, `treatment_plan_followup_gmail.json` |
| 3 | Review request & response | Google Calendar + Google Business Profile | `retention_service.py`, `review_request_google_calendar.json` |
| 4 | After-hours emergency capture | Twilio | `emergency_service.py`, `emergency_capture_twilio.json` |
| 5 | Lead qualification (chat + SMS) | Webhook / Twilio | `lead_service.py`, `lead_qualification_chat.json` |
| 6 | Insurance verification | Schedule (daily 4pm) + Gmail reply | `insurance_service.py`, `insurance_verification_gmail.json` |

Plus a VAPI voice agent (booking, emergency triage, insurance/logistics FAQ)
covering the phone channel for modules 1, 4, 5 and 6.

---

## Quick start (backend + n8n + Postgres via Docker Compose)

```bash
cp .env.example .env
docker compose run --rm backend python -m app.cli gen-key      # prints ENCRYPTION_KEY, FINGERPRINT_SECRET, INTERNAL_API_TOKEN, STAFF_API_TOKEN, N8N_ENCRYPTION_KEY
# paste those into .env

# Google OAuth — see "Google Cloud Console setup" below first
docker compose run --rm backend python -m app.cli google-auth  # writes token.json

docker compose up
```

- Backend: http://localhost:8000/docs (disabled when `ENVIRONMENT=production`)
- n8n: http://localhost:5678
- Import the n8n workflows: `docker compose --profile import run --rm n8n-import` (or use n8n's UI — see `n8n-workflows/README.md`)
- Seed demo data to try the dashboards: `docker compose run --rm backend python -m app.cli seed-demo`

---

## Google Cloud Console setup

Both the backend and the n8n workflows need one Google Workspace identity
authorised — the **"Microns AI" service identity**, not the dentist's
personal Gmail (see the HIPAA note below).

1. **Create a project.** [console.cloud.google.com](https://console.cloud.google.com) → New Project → name it (e.g. "Microns Dental Automation").
2. **Enable APIs.** APIs & Services → Library, enable each of:
   - Google Calendar API
   - People API (Contacts)
   - Gmail API
   - Google Drive API
   - Google Business Profile Business Information API + Business Profile Reviews API (only if using Module 3's review-response feature — requires a *verified* Business Profile listing, separate from the OAuth grant)
3. **Configure the OAuth consent screen.** APIs & Services → OAuth consent screen. Choose **Internal** if your Workspace is a Google Workspace org (recommended — no verification review needed); **External** + "Testing" mode also works for a single practice as long as you keep the OAuth app in testing and add the Microns AI account as a test user.
4. **Create OAuth credentials.** APIs & Services → Credentials → Create Credentials → OAuth client ID → **Desktop app**. Download the JSON — save it as `credentials.json` at the repo root (`microns-dental-native/credentials.json`). This file is the OAuth *client*; it is safe-ish to keep locally but never commit it.
5. **Run the OAuth flow once**, authenticating as the Microns AI Google account (not a dentist's personal one):
   ```bash
   docker compose run --rm backend python -m app.cli google-auth
   ```
   This opens a browser consent screen (or prints a URL if headless — see below) and writes `token.json`, which auto-refreshes after that.
   - **Headless server?** Run the same command on your laptop against the same `credentials.json`, then copy the resulting `token.json` up to the server. The refresh token keeps working wherever the file lives.
6. **Grant calendar access.** In Google Calendar, share each calendar you'll reference below with the Microns AI account ("Make changes to events" permission), or run the OAuth flow as the Microns AI account that already owns them.
7. **Create the calendars.** You need (at minimum) a practice "Appointments" calendar, plus dedicated tracking calendars for recall and treatment-plan follow-up, and an on-call and front-desk calendar if you're using modules 4 and 5's calendar features. Get each calendar's ID from Calendar → Settings → *that calendar* → "Integrate calendar" → Calendar ID, and put them in `.env` (`GOOGLE_PRIMARY_CALENDAR_ID`, `GOOGLE_RECALL_TRACKING_CALENDAR_ID`, etc.).
8. **Business Profile (optional, Module 3 only).** Find your account/location resource names via `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts` (authorised as the Microns AI account, which must be a manager/owner on the practice's verified Business Profile listing), then set `GOOGLE_BUSINESS_PROFILE_LOCATION=accounts/<id>/locations/<id>`.

### Registering the Calendar push-notification channel

Google Calendar's "event ended"/"event created" *trigger* (used by the
backend's `/retention/calendar-webhook`, not needed for the n8n workflows —
they poll via their own Google Calendar Trigger node) requires an
`events.watch` call per calendar:

```python
from app.services.google_calendar_service import GoogleCalendarService
GoogleCalendarService().watch(
    calendar_id="primary",
    channel_id="microns-dental-primary",
    webhook_url="https://YOUR-DOMAIN/retention/calendar-webhook?calendar_id=primary",
)
```

Channels expire after at most 30 days — put the same call in a weekly cron.

## Formatting Google Calendar event descriptions for the practice

Both implementations parse patient context out of a calendar event's
**description** (never the *title*, which is what shows on a lock screen).
Whatever creates your appointments — a PMS export, a Zapier step, a manual
front-desk habit — needs to write description text in this exact
`KEY: value` format, one per line:

```
PATIENT_ID: p_10234
PATIENT: Jane Doe
PHONE: +15551234567
EMAIL: jane@example.com
SERVICE: Cleaning
PROVIDER: Dr. Smith
TREATMENT_PLAN: Crown on #14
TP_SCHEDULED: NO
TP_VALUE: $1,200.00
INSURANCE: Delta Dental PPO
MEMBER_ID: MID123456
```

Only the keys relevant to that appointment are needed — `TREATMENT_PLAN`/
`TP_SCHEDULED`/`TP_VALUE` only matter for a consultation where a plan was
presented; `INSURANCE`/`MEMBER_ID` only matter for a new-patient exam. The
parser and builder live in `app/services/google_calendar_service.py`
(`CalendarEventParser`) and are unit-tested in `backend/tests/test_calendar_parser.py`.

For "new patient" detection (Module 6), put "New Patient" somewhere in the
`SERVICE` value — the filter is a case-insensitive substring match; adjust
`InsuranceService.request_verifications_for_tomorrow` if your practice tags
new patients differently.

## Importing the n8n workflows

See `n8n-workflows/README.md` for the full walkthrough. Short version:
Workflows → Import from File for each of the six JSON files, create the four
Data Tables they reference, fill in every `<__PLACEHOLDER_VALUE__...__>`
string, connect credentials, activate.

## Configuring VAPI

1. Create an assistant in the VAPI dashboard, or `POST` `voice-agent/vapi-config.json` to VAPI's Assistants API.
2. Paste `voice-agent/system-prompts/booking-agent.txt` into the assistant's system prompt (it already embeds the emergency-triage rule and points to `answer_faq` for logistics — `emergency-triage-agent.txt` and `insurance-faq-agent.txt` are the detailed reference docs those two tool calls follow server-side).
3. Set `serverUrl` to `https://YOUR-DOMAIN/webhooks/vapi` and `serverUrlSecret` to the same value as `VAPI_WEBHOOK_SECRET` in `.env`.
4. For local testing: `ngrok http 8000`, then point `serverUrl` at the ngrok URL.
5. Sign a BAA with VAPI and with whichever transcription/voice vendors it uses before taking real patient calls — see the HIPAA checklist below.

## Embedding the chat widget

```html
<script
  src="https://api.your-practice.com/widget/microns-dental-chat.js"
  data-api="https://api.your-practice.com"
  data-practice="Microns Dental"
  data-color="#2563eb"
  defer></script>
```

Open `frontend/chat-widget/demo.html` locally to try it against a running
backend on the same origin. Add your site's real origin to `CORS_ORIGINS` in
`.env` before going live.

## Dental SMS template library

Every outbound SMS in the backend goes through `app/services/sms_service.py`,
which holds ~20 named templates covering every module (hygiene recall
30/60/90/120-day, review request, emergency missed-call/reassurance/office-
hours/slot-offer, lead-qualification reply/consultation-hold/warm-ack/nurture
day1-3-7, insurance-verified copay, booking/reschedule/cancellation
confirmation) plus the AI-drafted, dentist-approved treatment-plan follow-up
text (never a fixed template, by design — see Module 2 below). Open that file
to read or edit the exact copy; every function takes the data it needs and
returns the finished message, so a copy edit never means hunting through
five call sites.

## Gmail approval workflow — what a dentist actually does

Three modules draft an AI-written message and wait for a human sign-off
before anything reaches a patient or goes public:

- **Module 2** drafts each stage's follow-up SMS as `[APPROVE-TP-<tag>-DAY<n>]`.
- **Module 3** drafts a review reply as `[APPROVE-REVIEW-<id>]`.
- **Module 6** drafts a verification *request* to the insurance coordinator as `[VERIFY-<id>]` (the coordinator's reply, not an approval, is what advances this one).

Every draft lands in the **Microns AI** Gmail account, not the dentist's own
inbox — HIPAA note below. To approve: **forward or reply to the draft** after
it's been sent to your own inbox as a real message (a draft that hasn't been
sent has no inbox thread to reply to — send it to yourself first, or have
front desk do a daily sweep). The backend polls for a subject match
(`/internal/*/poll-approvals`, run on a cron — see below); n8n's version uses
a native Gmail Trigger node instead, which is push-based.

### Running the backend's daily/polling jobs

The backend does not schedule its own cron — point any scheduler (a cron
container, `systemd` timer, or n8n's own Schedule Trigger calling these same
URLs) at these, all under `/internal` and requiring `X-Internal-Token`:

```
0 9 * * *    POST /internal/recalls/process-due
0 10 * * *   POST /internal/treatment-plans/process-due
*/15 * * * * POST /internal/treatment-plans/poll-approvals
0 11 * * *   POST /internal/reviews/process-due
*/15 * * * * POST /internal/reviews/poll-approvals
30 9 * * *   POST /internal/leads/nurture/process-due
0 16 * * *   POST /internal/insurance/request-tomorrow
*/15 * * * * POST /internal/insurance/poll-replies
```

## Troubleshooting

- **"No Google OAuth token" errors.** Run `python -m app.cli google-auth`. Check `GOOGLE_TOKEN_PATH` points at a real, readable file.
- **A workflow/endpoint fails instantly with "Not a valid Calendar ID."** Every `<__PLACEHOLDER_VALUE__...>` calendar ID must be filled in — n8n validates every Resource-Locator field in a workflow before running any node, even branches you didn't trigger, so one unfilled ID can block an entire workflow. See `n8n-workflows/README.md`.
- **SMS is "recorded" but not delivered.** `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER` are unset — the backend intentionally degrades to a dry-run (audited, not sent) rather than failing the whole request.
- **AI replies are generic/rule-based instead of model-generated.** `OPENAI_API_KEY` is unset, or still the placeholder `sk-...`. Everything still works — lead qualification and insurance-reply parsing fall back to deterministic keyword/regex logic.
- **Gmail draft isn't found by the approval poller.** Make sure the draft was actually *sent* (to yourself, or forwarded) — n8n/the backend search the inbox, not the Drafts folder, since a draft has no thread to reply to.
- **Deadlocked / hanging request touching any Google API.** This was a real bug caught during development (a non-reentrant lock in `GoogleAuthService` deadlocking against itself) — already fixed by using `threading.RLock()`. If you see a hang here after modifying that file, check you haven't reintroduced a nested lock acquisition.
- **`pytest` hangs instead of failing fast.** Same class of issue as above — always run new tests with a `timeout` wrapper during development, since a real deadlock produces no output at all rather than a clean failure.

---

## HIPAA compliance checklist

- [ ] **Google Workspace Business Plus or Enterprise**, with a signed BAA covering Calendar/Contacts/Gmail/Drive/Business Profile.
- [ ] **OpenAI**: signed BAA + Zero Data Retention enabled on the org (`OPENAI_ZERO_RETENTION=true` is enforced by this backend, but ZDR itself is a vendor-side setting).
- [ ] **Twilio**: signed BAA for Programmable SMS/Voice before any appointment-related text goes out.
- [ ] **VAPI** and its underlying transcription/voice vendors: signed BAAs before taking real patient calls.
- [ ] `ENCRYPTION_KEY` generated and stored in a secrets manager, never in git; `.env`, `credentials.json`, `token.json` are all in `.gitignore`.
- [ ] `INTERNAL_API_TOKEN` and `STAFF_API_TOKEN` rotated from their placeholder values.
- [ ] Every calendar-event *title* contains no PHI (titles show on lock screens); PHI lives only in the description, which this system reads via the API.
- [ ] SMS copy defaults to omitting treatment names (`SMS_INCLUDE_TREATMENT_DETAILS=false`) — flip only with dentist sign-off.
- [ ] Review the audit trail periodically: `docker compose exec backend python -m app.cli audit-report --days 30`.
- [ ] Key rotation drill: move the current `ENCRYPTION_KEY` to `ENCRYPTION_KEYS_OLD`, set a new one, deploy, then `python -m app.cli rotate-phi`.

---

## Testing

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```

31 tests cover encryption round-tripping and fingerprinting, PHI
de-identification/re-identification, the calendar-description parser, the
treatment-plan stage state machine, insurance-reply regex fallback parsing,
emergency-keyword parsing, lead-scoring logic across all three tiers, and a
handful of API-level smoke tests (health check, auth enforcement, the full
chat-widget conversation flow). None of them touch a real Google/Twilio/
OpenAI API — `conftest.py` configures the test environment so every
external-service code path takes its "not configured" branch instead.
