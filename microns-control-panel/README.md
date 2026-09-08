# Microns Control Panel

Accounts, billing, and per-clinic provisioning of the Microns revenue engine.

The engine in `../microns-ai-system` is single-tenant by design: one clinic, one
database, one encryption key. This service is what turns that into a product —
it signs people up, takes their money, and builds each of them their own engine.

---

## Tenancy: one deployment per clinic

Every clinic gets its own Railway project, its own Postgres with its own volume,
and its own encryption key. Nothing is shared.

The alternative — one database with a `tenant_id` on every table — is cheaper to
run and was rejected anyway. It would mean retrofitting a tenant predicate into
every query in a codebase that handles PHI, where a single missed `WHERE` clause
returns one clinic's patients to another. Here the isolation is
infrastructural rather than conditional: there is no query that *could* cross a
tenant boundary, because there is no shared table to cross. It is also why none
of the engine's existing tests had to change.

What it costs: roughly $15–25/month of Railway per clinic, and provisioning has
to be automated — which is most of what this service is.

---

## Handing a clinic over

`docs/HANDOVER.md` covers the whole flow: create, build, point a domain at it,
reveal the sign-in details, back up the key. It also lists what does *not* work
on day one — SMS needs A2P registration, bookings need calendar credentials —
because "the texts are not going out yet" is a very different conversation
before signature than after.

## Running it locally

```bash
cp .env.example .env
python -m app.cli gen-key        # put the result in MASTER_KEY
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

Without `RAILWAY_API_TOKEN` the app runs fine and clinics can be created, but
provisioning is refused with a clear message. Without Stripe, signup works and
nothing is billed. Both states are reported at boot and on `/health`.

```bash
pytest -q                        # 99 tests
python -m app.cli migrate        # bring the schema to head
python -m app.cli make-staff you@example.com
```

---

## MASTER_KEY, and what it protects

This database holds each clinic's `ENCRYPTION_KEY`, sealed with `MASTER_KEY`.
That clinic key decrypts that clinic's patient records.

Holding a copy is a deliberate choice. The alternative is that a Railway
environment variable is the only copy in existence, and the engine's own
documentation already names that as the top data-loss risk: lose the variable
and the records are unrecoverable, permanently. A sealed copy makes
re-provisioning, disaster recovery and key rotation possible.

What that obliges you to do:

- **Back `MASTER_KEY` up outside this system**, in a password manager or a safe.
  If you lose it, every clinic's escrowed key becomes unreadable — the clinics
  keep running, because their engines hold their own copy, but you can no longer
  rebuild one.
- **Never log it, never commit it.** `.env` is gitignored; keep it that way.
- **Rotate through `MASTER_KEYS_OLD`.** Put the new key in `MASTER_KEY` and the
  previous one in `MASTER_KEYS_OLD`; the newest seals, any listed key unseals.
  Removing the old key before rows are resealed makes those rows unreadable.

Every read of a clinic key writes an audit row. That record is the point: the
key itself is already in the database, so who looked at it is the part that has
to be reliable.

---

## What provisioning guarantees

`app/services/provisioning.py` runs ten recorded steps. Two of them are the
reason the module is written the way it is, and both are asserted in tests
rather than left to whoever edits the sequence next.

**The volume is attached before the database is ever deployed.** A Postgres
without a volume starts perfectly and writes to the container filesystem.
Nothing looks wrong — until the container is replaced, and every record goes
with it. `ATTACH_VOLUME` therefore precedes `DEPLOY_DATABASE`, the mount path is
asserted equal to `/var/lib/postgresql/data`, and `PGDATA` is asserted to agree
with it.

**Every clinic gets `ENVIRONMENT=production`.** In the engine, that one value
decides whether `assert_production_ready` refuses to boot on a missing key,
whether the PHI check in `llm.py` raises or merely logs, whether an unset VAPI
secret is a 503 or an open webhook, and whether `/docs` is served. It is written
by the provisioner, so it is not a default anybody can forget.

A test cross-checks every variable name against the engine's own `config.py`,
because a typo is silently ignored: the clinic boots with a default secret while
the console reports it configured.

Failures are recoverable. Each step records its start and outcome, so a
half-built clinic can be read rather than guessed at, and a retry skips what
already exists. A retry never mints a second encryption key — that would make
every row already written unreadable.

---

## Billing

Stripe owns the money; this service owns one question: should this account's
clinics still be serving traffic?

A billing problem **suspends, it never destroys**. Losing entitlement scales the
engine to zero and leaves the database, its volume and every record untouched;
regaining it is one call back. `past_due` still entitles service — a card that
failed this morning should not take a clinic's phone line down this afternoon,
and Stripe's own dunning gets its retry window first.

Cancellation and card management live in Stripe's billing portal rather than
being rebuilt here. Deprovisioning is a separate, deliberate operator action and
is not something a failed payment can trigger.

---

## Deploying

Point a Railway service at this directory with `railway.json` (Dockerfile
builder, healthcheck on `/health`). Attach a Postgres **with a volume mounted at
`/var/lib/postgresql/data`** — the same rule this service enforces for the
clinics it builds applies to it.

Required in production, or it refuses to boot:

| Variable | Why |
|---|---|
| `MASTER_KEY` | Unwraps every clinic secret. |
| `SESSION_SECRET` | Signs session cookies. |

Then set `RAILWAY_API_TOKEN`, `RAILWAY_WORKSPACE_ID`, the Stripe keys, and
`ALLOWED_HOSTS` to the real host. Point Stripe's webhook at
`/api/billing/webhook`.

---

## Runbook: the Backend3 volume

**This is urgent and is not something this service can fix for you.**

The existing `Backend3` deployment in the `microns-ai-system` Railway project
runs against a Postgres whose live config has **no volume mount**. A patch that
would add one is staged and has never been deployed. That database is on
ephemeral disk: it holds its records only because the container has not been
replaced. One restart, redeploy or host migration loses all of it.

**The staged patch is project-wide and atomic.** Patch
`512421b5-f1e8-47d9-8de1-45619c4a91fe` carries 19 changes spanning both
services: Postgres2's slice mounts the volume, Backend3's changes a domain
port. They cannot be applied separately. So the dashboard Deploy button that
ships new code is also the button that restarts Postgres2 onto a fresh, empty
volume — and nothing warns you. Take the dump before pressing anything.

The full ordered operation, including clearing the demonstration records before
`ENVIRONMENT=production` makes that impossible, is in
[`../microns-ai-system/docs/BACKEND3-HARDENING.md`](../microns-ai-system/docs/BACKEND3-HARDENING.md).

Take a dump on a schedule afterwards. Railway's volume backups cover the volume;
they do not cover the window before it existed.

Separately, `Backend3` runs with `ENVIRONMENT=demo`, which disables the engine's
production guards — see the audit notes. That is correct for a sales demo and
wrong for real patient data. Clinics built by this control panel are never in
that state.

---

## Layout

```
app/
  config.py         settings, and the production checks
  database.py       engine, session, migrations
  dependencies.py   auth and the tenant boundary
  models/           accounts, users, clinics, subscriptions, events
  routers/          auth, clinics, billing
  services/
    accounts.py     signup, sign-in, password lifecycle
    audit.py        the administrative trail
    billing.py      Stripe, entitlement, suspend/resume
    crypto.py       envelope encryption for clinic secrets
    passwords.py    argon2id
    provisioning.py the ten-step build
    railway.py      Railway's GraphQL API
    secrets.py      per-clinic secret generation
    sessions.py     signed, revocable cookies
web/                the owner UI: static ES modules, no build step
tests/              81 tests
```
