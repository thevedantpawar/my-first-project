# Promoting Backend3 from demo to production

One ordered operation. It does four things that have to happen together, in
this order, because each one closes a door on the next:

1. Backs up a database that currently has no backup and no volume.
2. Gives that database a volume, so it stops being one restart from empty.
3. Removes the demonstration records **while that is still permitted**.
4. Turns on the engine's production guards.

Read the whole thing before starting. Two of the steps are irreversible in the
direction that matters.

---

## Why the order is not negotiable

**The staged patch is atomic.** Railway holds one project-wide staged patch,
`512421b5-f1e8-47d9-8de1-45619c4a91fe`, with 19 changes. Postgres2's slice adds
the volume mount; Backend3's slice changes a domain port. They cannot be applied
separately. Deploying it restarts Postgres2 onto a **fresh, empty** volume.

That means the Deploy button in the Railway dashboard — the one that ships new
code — is also the button that empties the database. Nothing warns you.
**Do not press it before step 1.**

**Clearing demo data is refused in production.** `demo_service.clear` calls
`assert_seedable`, which raises once `ENVIRONMENT` is `production`. The guard
cannot tell a fictional patient from a real one, so it will not try, and there
is no force flag. Set `ENVIRONMENT=production` first and the 88 fictional
patients become permanent residents of a clinical database.

---

## Current state

Backend3 boots as `env=demo, booking=generic, llm=gemini, sms=dry-run`. Its
configured variables are:

```
ALLOWED_HOSTS  CLINIC_NAME  CORS_ORIGINS  DATABASE_URL  DEMO_MODE
DEMO_SEED_ON_BOOT  ENCRYPTION_KEY  ENVIRONMENT  FINGERPRINT_SECRET
GEMINI_API_KEY  GEMINI_MODEL_FAST  GEMINI_MODEL_SMART  INTERNAL_API_TOKEN
LLM_PROVIDER  N8N_WEBHOOK_BASE_URL  OPENAI_ZERO_RETENTION  PORT
STAFF_API_TOKEN
```

Two things follow from that list:

- **`VAPI_WEBHOOK_SECRET` is absent.** Under `ENVIRONMENT=demo` the guard in
  `voice.py` logs a warning and allows the call, so `/voice/inbound`,
  `/voice/action`, `/voice/end` and `/webhooks/vapi` are reachable by anyone who
  finds the URL. Under `production` the same code returns 503 instead — safe,
  but the voice agent stops working until the secret is set.
- **No `TWILIO_*`, no `BOOKING_*`, no `GOOGLE_*`.** SMS, booking write-back and
  calendar integration are unconfigured, which matches the boot log.

---

## Step 1 — Back up, before touching anything

Nothing else in this document is safe until this file exists and you have
checked it.

```bash
railway link                      # select microns-ai-system / production
railway run --service Postgres2 \
  pg_dump "$DATABASE_URL" --no-owner --no-acl \
  > backend3-$(date +%F-%H%M).sql
```

Verify it is real, not an empty file or an error page:

```bash
ls -lh backend3-*.sql                       # tens of KB at least
grep -c "COPY public.patients" backend3-*.sql   # must be 1
grep -c "COPY public.audit_logs" backend3-*.sql # must be 1
```

Keep a copy somewhere that is not Railway.

## Step 2 — Apply the staged patch, and restore

Railway dashboard → the project → deploy the staged changes. Postgres2 restarts
onto the volume at `/var/lib/postgresql/data`, which is empty.

```bash
railway run --service Postgres2 psql "$DATABASE_URL" < backend3-YYYY-MM-DD-HHMM.sql
```

Check the row counts match the dump:

```bash
railway run --service Postgres2 psql "$DATABASE_URL" -c \
  "select 'patients' t, count(*) from patients
   union all select 'appointments', count(*) from appointments
   union all select 'leads', count(*) from leads
   union all select 'audit_logs', count(*) from audit_logs;"
```

From here the database survives a restart. That was the P0.

## Step 3 — Deploy the merged code

Backend3 is on `2523c78` and its auto-deploy is not firing — it never picked up
`17a876d` either. Deploy the current head of
`claude/microns-medspa-v2-ui-3t08hh`, which now includes PR #5.

On boot the engine finds the six tables and no `alembic_version`, stamps the
baseline and upgrades to head. It does not rebuild anything; a test inserts a
row, bootstraps, and asserts the row is still there. Confirm in the deploy log:

```
Database predates migrations — stamping it at the baseline (600c428b0614)
Database schema ready (6 tables, migrated to head)
```

## Step 4 — Clear the demonstration records

Still `ENVIRONMENT=demo` at this point. That is the entire reason this step is
here rather than later.

Set on Backend3, then deploy:

```
DEMO_CLEAR_ON_BOOT=true
```

The boot log will say what it removed:

```
DEMO_CLEAR_ON_BOOT: removed demonstration records {...}
```

Open `/console` and confirm it is empty. Then **unset `DEMO_CLEAR_ON_BOOT`**
before continuing — leaving it set is harmless (it no-ops on an empty database)
but it is a loaded gun pointed at any future seeding.

Only demo-tagged rows are deleted. A test seeds the clinic, adds a genuine
patient, clears, and asserts the genuine patient survives.

## Step 5 — Turn on the production guards

Set these together and deploy once:

| Variable | Value | What it does |
|---|---|---|
| `ENVIRONMENT` | `production` | The master switch. Enables `assert_production_ready`, makes the PHI check in `llm.py` raise instead of log, turns an unset VAPI secret into a 503, closes `/docs`, `/redoc` and `/openapi.json`, applies `TrustedHostMiddleware`, adds HSTS. |
| `DEMO_MODE` | `false` | Removes the demonstration banner. |
| `DEMO_SEED_ON_BOOT` | `false` | Must be false, or the next boot re-seeds what step 4 removed. |
| `ALLOWED_HOSTS` | `backend3-production-564b.up.railway.app` | `*` means the engine skips host checking entirely, even in production. |
| `CORS_ORIGINS` | `https://backend3-production-564b.up.railway.app` | Same reasoning. |
| `VAPI_WEBHOOK_SECRET` | *the assistant's `serverUrlSecret`* | Without it the voice endpoints return 503 in production. Set it to the same value configured on the VAPI assistant. |

The engine **refuses to boot** in production if `ENCRYPTION_KEY`,
`FINGERPRINT_SECRET` or `INTERNAL_API_TOKEN` is unset or still a default. All
three are already set — the only startup warning today is Twilio — so it should
come up. If it does not, the log names the offending variable.

### The language model needs a decision

`LLM_PROVIDER=gemini` today. The Gemini Developer API has no zero-retention
setting and Google's BAA covers Vertex AI rather than this endpoint, so
`llm_zero_retention` is `False` and production boot emits a compliance warning.
Prompts are de-identified before they are sent, but the arrangement is not
BAA-covered. Three ways forward:

- `LLM_PROVIDER=none` — the deterministic rule engine. Everything keeps working;
  the agents' wording gets less fluent. Safe today, no paperwork.
- `LLM_PROVIDER=openai` with `OPENAI_API_KEY`, ZDR enabled on the org and a BAA
  signed. `OPENAI_ZERO_RETENTION` is already set.
- Move to Vertex AI, which is BAA-eligible. Needs an adapter that does not exist.

Until one of those is done, real patient data is being processed through an
endpoint with no BAA. That is a finding, not a preference.

## Step 6 — Verify

```bash
curl -s https://backend3-production-564b.up.railway.app/health | python3 -m json.tool
```

Expect `environment: production`, `database: ok`, and a `warnings` array that
contains only things you have consciously accepted. Then:

```bash
curl -o /dev/null -w "%{http_code}\n" https://backend3-production-564b.up.railway.app/docs
# 404 — the interactive docs are closed in production

curl -o /dev/null -w "%{http_code}\n" -X POST \
  https://backend3-production-564b.up.railway.app/voice/inbound
# 401 if VAPI_WEBHOOK_SECRET is set, 503 if it is not. Never 200.
```

And confirm the console still signs in with the staff token, and that the
Glow Aesthetics records are gone.

---

## What this does not fix

- **SMS still does not send.** No Twilio credentials, and A2P 10DLC carrier
  registration takes weeks. Every reminder, reactivation and review request is
  still composed, audited and discarded. Start the registration independently of
  this operation.
- **Nothing writes to a real calendar.** The Google Calendar adapter shipped but
  has no credentials, so hot leads book into the internal scheduler only.
- **Rate limiting is in-process** and covers the chat and qualify endpoints
  only. `/voice/*` and `/webhooks/*` are unthrottled. Put a real limiter in
  front before this is exposed to meaningful traffic.
- **One replica, `restartPolicyMaxRetries: 3`.** After three crashes it stays
  down, silently.
- **`ENCRYPTION_KEY` must be backed up outside Railway.** With the volume
  attached the rows survive a restart, but they are unreadable without the key.
