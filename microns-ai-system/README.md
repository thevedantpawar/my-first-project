# Microns AI System

Production-ready AI automation for med spas and aesthetic clinics. Three agents
and one owner-facing console, on a single HIPAA-aware backend:

| Module | What it does |
|---|---|
| **AI Voice Agent** | Answers the phone 24/7 via VAPI — books, reschedules, cancels, quotes prices, escalates anything clinical |
| **Patient Retention** | 24h/2h reminders, no-show recovery, review requests with AI-drafted replies, dormant-patient reactivation |
| **Lead Qualification** | Website chat widget + inbound SMS, six-question qualification, scored 0-100 and routed hot / warm / cold |
| **Owner Console** | The clinic-facing interface at `/console` — what needs attention, what the AI handled, and where revenue is being recovered |

Everything runs with one command. No third-party account is required to see it
work end to end — without an OpenAI key the system falls back to a deterministic
rule engine, and without Twilio every message is recorded and audited but not
delivered.

---

## Quick start

```bash
git clone <your-repo> && cd microns-ai-system
cp .env.example .env

# Generate real secrets and paste them into .env
docker compose run --rm backend python -m app.cli gen-key

docker compose up
```

| Service | URL |
|---|---|
| Owner console | http://localhost:8000/console |
| API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |
| Health | http://localhost:8000/health |
| n8n | http://localhost:5678 |
| Widget demo | http://localhost:8000/widget/demo.html |

Optional demo data:

```bash
docker compose exec backend python -m app.cli seed-demo
```

`GET /health` tells you what is actually wired up:

```json
{
  "status": "ok",
  "integrations": {"openai": false, "twilio": false, "vapi": true, "calendly": false},
  "warnings": ["OPENAI_API_KEY is not set — ... falls back to the deterministic rule engine."]
}
```

### Without Docker

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://microns:password@localhost:5432/microns_db
uvicorn app.main:app --reload
```

---

## Architecture

```
                    ┌──────────────┐
   Phone ──VAPI────▶│              │
                    │              │──▶ PostgreSQL 15  (PHI encrypted at rest)
   Website ─chat───▶│   FastAPI    │──▶ Redis          (cache / jobs)
                    │   backend    │──▶ OpenAI         (de-identified prompts only)
   SMS ───Twilio───▶│              │──▶ Twilio         (SMS, consent-checked)
                    │              │──▶ Acuity/Square  (booking, optional)
   Owner ──console─▶│              │
        (staff token)└──────┬───────┘
                           │  UUIDs and booleans only — never PHI
                    ┌──────▼───────┐
                    │     n8n      │  5 workflows: cron + webhook orchestration
                    └──────────────┘
```

```
microns-ai-system/
├── docker-compose.yml          # postgres · redis · backend · n8n
├── .env.example
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app, middleware, health
│   │   ├── config.py           # settings + startup safety checks
│   │   ├── database.py         # engine, session, schema bootstrap
│   │   ├── dependencies.py     # request id, audit, auth
│   │   ├── schemas.py          # Pydantic v2 request/response models
│   │   ├── ratelimit.py        # in-process limiter for public routes
│   │   ├── utils.py            # UTC time policy, masking helpers
│   │   ├── cli.py              # gen-key · seed-demo · rotate-phi · audit-report
│   │   ├── models/             # encrypted column types + 6 tables
│   │   ├── routers/            # voice · retention · leads · webhooks · appointments ·
│   │   │                       #   internal · console
│   │   └── services/           # encryption · hipaa_audit · deidentify · llm · sms ·
│   │                           #   booking · voice · retention · lead · patient · notifier
│   ├── console/                # owner console (static SPA, no build step)
│   │   ├── index.html
│   │   ├── styles/             # tokens · base · components · pages
│   │   └── js/                  # api · router · store · ui/ · pages/
│   ├── tests/                  # 198 tests
│   ├── Dockerfile
│   └── requirements.txt
├── n8n-workflows/              # 5 importable JSON workflows + README
├── voice-agent/
│   ├── vapi-config.json        # assistant config incl. 8 tool definitions
│   ├── price-list.json
│   └── system-prompts/         # booking-agent.txt · faq-agent.txt
└── frontend/chat-widget/       # microns-chat.js (no dependencies) + demo.html
```

---

## Module 1 — AI Voice Agent

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/voice/inbound` | Call started — returns assistant overrides and greeting |
| `POST` | `/voice/action` | Tool call — availability, booking, pricing, callback |
| `POST` | `/voice/end` | Call ended — stores encrypted transcript and outcome |
| `POST` | `/webhooks/vapi` | Single-URL dispatcher; routes by `message.type` to the three above |

All four require the `X-Vapi-Secret` header.

### Configuring VAPI

1. **Expose the backend.** VAPI needs a public HTTPS URL. Locally:
   `ngrok http 8000`.
2. **Create the assistant** from `voice-agent/vapi-config.json` — the VAPI
   dashboard, or:
   ```bash
   curl -X POST https://api.vapi.ai/assistant \
     -H "Authorization: Bearer $VAPI_API_KEY" \
     -H "Content-Type: application/json" \
     -d @voice-agent/vapi-config.json
   ```
   Replace `serverUrl`, `serverUrlSecret` and `voiceId` first, and paste
   `system-prompts/booking-agent.txt` into `model.messages[0].content`.
3. **Set the secret.** `serverUrlSecret` must equal `VAPI_WEBHOOK_SECRET` in
   `.env`. VAPI sends it as `X-Vapi-Secret`; the backend rejects requests
   without it.
4. **Attach a phone number** to the assistant in the VAPI dashboard.
5. **Test:**
   ```bash
   curl -X POST http://localhost:8000/voice/inbound \
     -H "X-Vapi-Secret: $VAPI_WEBHOOK_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"message":{"type":"assistant-request","call":{"id":"test_1","customer":{"number":"+15551234567"}}}}'
   ```

### The eight tools

`check_availability` · `book_appointment` · `lookup_appointment` ·
`reschedule_appointment` · `cancel_appointment` · `get_pricing` ·
`answer_faq` · `request_callback`

Bookings are created as **pending**, not confirmed: the slot is held
immediately, and the front desk confirms. A voice agent mishearing "the
fourteenth" as "the fortieth" should not put a confirmed appointment on the
calendar.

### The clinical boundary

The agent never answers a clinical question. Anything matching contraindications,
medications, pregnancy, side effects or a reaction routes to `request_callback`,
which says *"That's an important question for our medical provider. I'll have
them call you back within 2 hours"*, texts an acknowledgement, and fires the
handoff workflow. The 2-hour promise is then tracked: `voice_handoff.json`
escalates anything still outstanding.

---

## Module 2 — Patient Retention

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/retention/dashboard` | staff | No-show rate, review velocity, reactivation and lead stats |
| `GET` | `/retention/patients-at-risk` | staff | No visit in 45+ days and nothing booked |
| `POST` | `/retention/trigger-review` | staff | Manually request a review |
| `POST` | `/retention/reactivate/{patient_uuid}` | staff | Dormant-patient SMS (30-day cooldown) |
| `POST` | `/retention/review-received` | staff | Record a review, get an AI-drafted reply |
| `GET` | `/retention/events/{patient_uuid}` | staff | Retention timeline for one patient |
| `GET` | `/api/appointments/upcoming` | internal | Feeds Workflow A |
| `GET` | `/api/appointments/no-shows` | internal | Feeds Workflow B |
| `POST` | `/internal/reminders/send` | internal | Idempotent reminder send |
| `POST` | `/internal/no-shows/detect` | internal | Flag past-due appointments as no-shows |
| `POST` | `/webhooks/treatment-completed` | — | Starts the review clock |

Every send is **idempotent**: a cron that fires twice texts once.

### Importing the n8n workflows

```bash
docker compose --profile import run --rm n8n-import
docker compose restart n8n
```

Then open http://localhost:5678, review each workflow, and click **Active**.
They import inactive on purpose.

Full details, including the environment the workflows read and why they call
the backend instead of Twilio directly, are in
[`n8n-workflows/README.md`](n8n-workflows/README.md).

---

## Module 3 — Lead Qualification

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/leads/chat` | public (rate limited) | One conversation turn |
| `POST` | `/leads/sms-inbound` | Twilio signature | Inbound SMS, same state machine |
| `POST` | `/leads/qualify` | public (rate limited) | Submit answers directly, get score + action |
| `GET` | `/leads/{lead_id}` | staff | De-identified lead status |

### Scoring

| Signal | Points |
|---|---|
| Treatment interest | Named treatment 15 · other 8 |
| Previous experience | Yes 15 · No 8 |
| Budget | $0-500 → 10 · $500-1000 → 20 · $1000-2000 → 28 · $2000+ → 35 |
| Timeline | ASAP 35 · 1-2 weeks 28 · 1 month 15 · browsing 5 |

| Score | Route |
|---|---|
| **80-100 — hot** | Auto-book a consultation, SMS confirmation |
| **50-79 — warm** | Staff follow-up within 24h, escalated if missed |
| **0-49 — cold** | Educational SMS nurture drip |

Two gates sit outside the arithmetic:

- **Pregnant or breastfeeding → disqualified**, score 0, medical callback. No
  combination of the other five answers can override it.
- **Blood thinners → flagged** for provider approval, with no score penalty.
  It changes who signs off, not how interested the person is.

Flow control is deterministic; only language is generated. The model turns
"prob like 2 grand" into `1000-2000` and writes a warm acknowledgement — it
never decides what to ask next or what someone scores. When OpenAI is
unavailable, keyword rules cover the same ground and qualification is
unchanged.

### Embedding the chat widget

```html
<script
  src="https://api.your-clinic.com/widget/microns-chat.js"
  data-api="https://api.your-clinic.com"
  data-clinic="Radiance Med Spa"
  data-color="#0f766e"
  data-title="Chat with us"
  defer></script>
```

| Attribute | Default | Purpose |
|---|---|---|
| `data-api` | page origin | Backend base URL |
| `data-clinic` | "our clinic" | Header name |
| `data-color` | `#0f766e` | Brand colour |
| `data-title` | "Chat with us" | Launcher label |
| `data-position` | `right` | `right` or `left` |

Open it from the clinic's own CTA with `MicronsChat.open()`.

No dependencies, no build step, no cookies, no third-party requests. It renders
in a shadow root so the clinic's CSS cannot break it. Add the site's origin to
`CORS_ORIGINS` before going live. Live demo: http://localhost:8000/widget/demo.html

---

## Module 4 — Owner Console

The interface a clinic owner actually opens: `http://localhost:8000/console`.

Sign in with `STAFF_API_TOKEN`. It is held in `sessionStorage` for that tab
only and sent as `X-Staff-Token` — the same header every staff endpoint has
always required, so console access lands on the same audit trail as any other
client. There is no separate console session and no cookie.

| Page | What it answers |
|---|---|
| Overview | What did my AI team handle, and what needs me now? |
| Opportunities | Every recoverable moment — leads, missed visits, dormant clients, callbacks — with the recommended action |
| Conversations | Every enquiry across chat, text and phone, and who is handling it |
| Leads | The pipeline, with intent, score, journey and next best action |
| Appointments | Today, this week, what needs confirming, who booked it |
| Revenue | Where bookings came from, what was recovered, and the funnel |
| AI Team | The engine's modules as five specialists, with configuration behind a disclosure |
| Automations | The five n8n workflows drawn as sequences |
| Insights | Plain-language observations, each with the count behind it |
| AI Test Center | Run a scenario through the live qualification engine |
| Settings | What is connected, the retention timings, and the advanced view |

### What it reads

`GET /console/api/*` — staff-authenticated, read-only projections over rows the
engine already writes (`app/services/console_service.py`). Actions go through
the endpoints that already existed: `/retention/trigger-review`,
`/retention/reactivate/{uuid}`, `/api/appointments/{id}/status`. There is one
implementation of every side effect in this system, and the console does not
add a second.

The internal feeds under `/internal/*` stay internal. They authenticate with
n8n's machine token, which a browser has no business holding; where the console
needs the same information it reads it through `/console/api/*` under a staff
token instead.

### Three rules it will not break

**Nothing is invented.** Every number traces to a column. `price_cents` is
optional on an appointment, so revenue totals ship with the count of rows that
actually carried a price and the UI says "0 of 7 appointments have a recorded
price" rather than implying it knows the rest. Recovered *appointments* are
counted exactly and shown whether or not anyone recorded a dollar figure.

**Nothing claims a connection it does not have.** Twilio unconfigured means the
console says "composed and audited but not delivered", on the agent card, in
the confirmation dialog before you send, and in the toast afterwards. Whether a
workflow is switched on inside n8n is not observable from here, so the state
reads "Not observable" rather than "Active".

**Nothing identifies a patient.** Names arrive masked (`Jane D.`), phones as
last four digits, everything else as a UUID. Call transcripts are never
returned — the console reports that one exists and leaves it encrypted. Chat
and SMS keep no message text at all, so the conversation view says so instead
of rendering an empty thread.

### Front-end shape

Static ES modules and CSS, no build step and no third-party requests — the same
constraint the chat widget ships under, for the same reason: this page is
served from the same origin as the PHI API. Design tokens live in
`console/styles/tokens.css`; every page composes the primitives in
`console/js/ui/`. Charts are hand-drawn SVG rather than a charting dependency.

The Test Center runs against the live `/leads/chat` endpoint, so a run creates
a real lead record and a hot result triggers real follow-up. The page says so
before you run anything.

---

## HIPAA compliance

This system is built to be deployable under a BAA. Deploying it does not by
itself make a clinic compliant — that needs policies, training, risk analysis
and signed agreements. Here is exactly what the code does and does not do.

### What the code enforces

**1. No PHI in plain text.** `patient_name`, `phone`, `email`,
`treatment_history`, call transcripts and appointment notes use SQLAlchemy
`TypeDecorator`s (`EncryptedText`, `EncryptedString`) backed by Fernet —
AES-128-CBC with an HMAC-SHA256 signature and a random IV per value. Encryption
happens in the column type, so no caller can forget it. A test asserts this by
reading the raw database file and confirming the bytes are ciphertext.

Random IVs make `WHERE phone = ...` impossible, so lookups use
`phone_fingerprint` — a keyed HMAC-SHA256 of the normalised number. Deterministic
enough to index, useless without `FINGERPRINT_SECRET`.

**2. Audit everything.** Every PHI read/write, SMS, call and LLM request writes
to `audit_logs` *and* emits a structured `AUDIT: {...}` line on stdout. Records
carry a timestamp, action, patient UUID, a keyed hash of the subject, a data
*category*, and the actor. Never content. `_strip_phi()` redacts PHI-shaped keys,
and the model itself rejects them — so a careless `details={"phone": ...}`
produces a redacted row, not an incident. Failed authentication is audited too.

**3. De-identification before the LLM.** `app/services/deidentify.py` replaces
names, phones, emails, SSNs, MRNs, dates and street addresses with tokens
(`[PATIENT_1]`, `[PHONE_1]`) before any prompt leaves the process, and restores
them in the response. `LLMService` re-scans every outbound prompt and, in
production, **raises** rather than sending one that still contains an
identifier. This guard is vendor-blind — it runs identically on the OpenAI and
Gemini paths — and every `llm_request` audit row records the vendor that
actually received the prompt.

**4. No PHI in logs.** The access log records method, path and status — never
query strings or bodies. Unhandled exceptions return an opaque error with a
request id; the detail goes to the server log. `__repr__` on the models is
identifier-free. `mask_name()` / `mask_phone()` produce "Jane D." and
"***-***-4567" for staff dashboards.

**5. Transport and access.** HSTS and `Cache-Control: no-store` on every
response, `TrustedHostMiddleware` in production, docs disabled in production,
a non-root container user, timing-safe token comparison, Twilio signature
validation, VAPI secret verification, and a rate limiter on the public chat.

### What you must do

- [ ] **Sign BAAs** — your model vendor, Twilio, VAPI, your transcription/voice
      vendors, and your hosting provider. Nothing here substitutes for one.
- [ ] **Pick a model vendor you can sign with.** `LLM_PROVIDER=openai` with ZDR
      enabled on the org (`support@openai.com`) is BAA-coverable; the client
      sends `store=false` on every call, but ZDR is an account setting.
      `LLM_PROVIDER=gemini` uses the Gemini **Developer** API, which has no
      zero-retention setting and is **not** covered by Google's BAA — that
      covers Vertex AI. Prompts are de-identified either way, and `/health`
      reports `llm.zero_retention` honestly, but do not treat a Gemini
      Developer API deployment as BAA-covered.
- [ ] **Terminate TLS.** Run behind HTTPS. The API refuses nothing on
      plain HTTP by itself — put nginx/ALB/Cloudflare in front.
- [ ] **Encrypt the volumes.** Application-level encryption protects field
      values; enable disk encryption for backups, WAL and the n8n volume.
- [ ] **Back up `ENCRYPTION_KEY`** in a secrets manager. Lose it and every
      encrypted field is gone. Rotate with `ENCRYPTION_KEYS_OLD` +
      `python -m app.cli rotate-phi`.
- [ ] **Replace the shared tokens** with your IdP if more than one person needs
      access. The audit trail is only as good as the `user_id` in it.
- [ ] **Set a retention policy.** Nothing is auto-deleted. Most states require
      medical records for 6-10 years; call transcripts usually need far less.
- [ ] **Review SMS content.** `SMS_INCLUDE_TREATMENT_DETAILS` is `false` by
      default so texts say "your appointment", not "your Botox appointment" —
      texts land on lock screens.
- [ ] **Honour consent.** Reminders are transactional; reactivation, review
      requests and nurture are marketing and require `marketing_consent`.
      `STOP` is handled automatically.
- [ ] **Remove the postgres port mapping** from `docker-compose.yml` in
      production.

### Audit report

```bash
docker compose exec backend python -m app.cli audit-report --days 30
```

---

## Configuration

Every variable is documented in [`.env.example`](.env.example). The ones that
matter most:

| Variable | Notes |
|---|---|
| `ENCRYPTION_KEY` | Fernet key. **Back it up.** Without it, PHI is unrecoverable |
| `ENCRYPTION_KEYS_OLD` | Retired keys, decrypt-only, for zero-downtime rotation |
| `FINGERPRINT_SECRET` | Keys the deterministic lookup hashes |
| `INTERNAL_API_TOKEN` | n8n → backend. Must match on both services |
| `STAFF_API_TOKEN` | Staff dashboards (`X-Staff-Token`) |
| `VAPI_WEBHOOK_SECRET` | Must equal the assistant's `serverUrlSecret` |
| `LLM_PROVIDER` | `openai`, `gemini`, or `none`. Changes wording only — never flow, scoring or safety gates |
| `GEMINI_API_KEY` | Required when `LLM_PROVIDER=gemini`. Not BAA-covered; see the compliance section |
| `BOOKING_SYSTEM_TYPE` | `generic` (built-in), `acuity`, `square`, `mindbody` |
| `SMS_INCLUDE_TREATMENT_DETAILS` | `false` keeps treatment names off lock screens |
| `ENVIRONMENT` | `production` enables the strict checks and disables `/docs` |

In `production`, the app **refuses to start** with a missing `ENCRYPTION_KEY`
or a default `FINGERPRINT_SECRET` / `INTERNAL_API_TOKEN`.

---

## Tests

```bash
docker compose exec backend pytest -q          # or: cd backend && pytest -q
```

198 tests covering encryption at rest and key rotation, de-identification
round-trips, audit-trail completeness and PHI rejection, the scoring matrix and
both safety gates, reminder idempotency, no-show recovery, the review flow,
voice tool handling and transcript encryption, authentication, rate limiting,
the console's read API — including that it never returns an unmasked
identifier and never reports revenue it cannot account for — and provider
selection, including that the PHI guard holds on the Gemini path and that
Gemini is never reported as zero-retention.

They run on SQLite with no external services, so `pytest` works on a laptop with
nothing installed but the requirements.

---

## Notes on the build

A few places where the implementation makes a deliberate choice worth knowing
about:

- **n8n orchestrates; the backend acts.** The workflows call backend endpoints
  rather than Twilio/OpenAI nodes, so PHI never enters n8n's execution logs and
  every message stays on one audit trail. Rationale and the swap-in
  instructions are in `n8n-workflows/README.md`.
- **`RetentionEvent.metadata` is exposed as `event_metadata`.** `metadata` is
  reserved by SQLAlchemy's declarative API; the database column is still named
  `metadata`.
- **Hot-lead auto-booking has two paths.** With Calendly configured, its API
  cannot pick a time for someone, so the system mints a single-use scheduling
  link and texts it — the lead becomes `booked` when Calendly's
  `invitee.created` webhook arrives. Without Calendly, this system owns the
  calendar and books the next open consultation slot outright.
- **Long waits are queries, not Wait nodes.** The "3 days later" and "5 days
  later" branches are timestamp queries so a container restart cannot strand
  half the queue. The review workflow keeps a `Wait 5 Days` node as specified,
  with the polling endpoint available as the robust alternative.
- **The model vendor is swappable, the decisions are not.** `LLM_PROVIDER`
  selects OpenAI or Gemini behind one wrapper. Both paths go through the same
  de-identification guard and the same audit row; both degrade to the
  deterministic rule engine on any error, rate limit, safety block or
  unparseable reply. The Gemini path is plain `httpx` against the REST
  endpoint rather than another SDK, and it adds token headroom because Gemini
  3.x spends "thinking" tokens against `maxOutputTokens` — a budget sized for
  a non-thinking model comes back truncated.
- **Mindbody is not implemented.** Its Public API needs a per-site OAuth
  exchange that cannot be written blind. Selecting it logs a warning and uses
  the internal scheduler rather than silently dropping bookings. Acuity and
  Square are written against their documented REST APIs and need verification
  against a sandbox account before go-live.
- **The chat asks a seventh question.** After the six, it asks for a phone
  number — auto-booking a consultation and texting a confirmation needs
  somewhere to send it.
- **The rate limiter is per-worker and in-memory.** It stops casual abuse of
  the public chat endpoint. Put a real limiter in front before exposing the
  service.

---

## License

Proprietary — Microns.
