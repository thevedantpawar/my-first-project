# Giving a clinic access

What to do when you close a med spa and need to hand them a working system.

The short version: create the clinic, build it, point a domain at it, reveal the
sign-in details, and hand those over in person or through a password manager.
Ten minutes of work, most of it waiting for the build.

---

## 1. Create and build

Sign in to the control plane → **Clinics** → **Add a clinic**.

Name, time zone, opening hours, and the clinic's own booking and review URLs if
they have them. None of it is permanent except the slug, which is derived from
the name and becomes part of the Railway resource names.

Then **Build the engine**. It takes a couple of minutes and shows ten named
steps. What it produces:

- Their own Railway project, their own Postgres, **their own persistent volume**.
- Their own encryption key. No clinic shares a key with any other, so a
  compromise of one is a compromise of one.
- `ENVIRONMENT=production` from the first boot — not a default anyone has to
  remember to set, which is the mistake the original deployment made.

If a step fails, the failure is shown against that step and **Retry build**
resumes from where it stopped. A retry reuses the existing encryption key; it
never mints a second one, because a new key against an existing database makes
every row already written unreadable.

## 2. Point a domain at it

**Custom domain** → enter a hostname the practice owns → **Attach domain**.

Do this *before* handing anything over. The console bookmark, the chat widget
embed and the voice agent's server URL all hard-code whichever address they were
given, and the Railway-generated hostname changes if the service is ever
recreated. Moving them afterwards means finding all three.

Two DNS records come back and **both are required**. Without the TXT record the
domain stays pending forever, no certificate is issued, and it looks like
nothing is happening rather than like a missing step. Give both to whoever runs
the practice's DNS.

The Railway hostname keeps working afterwards, so nothing breaks in the gap
while DNS propagates.

### Which domain?

Use **one domain with a subdomain per clinic** — `glow.micronsai.com`,
`radiance.micronsai.com` — rather than a separate domain per system.

A second domain per clinic means a second thing to renew, a second certificate
to watch and a second brand to explain. A subdomain costs one DNS record. It
also keeps the control plane and the clinics visibly part of the same product,
which matters when the clinic's staff are typing the address into a browser to
look at patient records.

If you already own `micronsai.online`, that works — the point is one domain, not
which one. Put the control plane on something like `app.` and give each clinic
its own subdomain.

## 3. Hand over the sign-in details

**Hand over to the clinic** → **Show sign-in details**. You get:

| | |
|---|---|
| **Console URL** | Where their front desk signs in. |
| **Staff sign-in token** | What they type in. Treat it like a password. |
| **Widget snippet** | One `<script>` tag for their website, if they want the chat widget. |

Send the token through a password manager, or hand it over in person. Not email,
not WhatsApp, not a shared doc. It signs in to a console that shows patient
records.

Every time you reveal it, a row is written to the audit trail. That is
deliberate — the token is already in the database, so the record of who looked
at it is the part that has to be reliable.

**If it ever goes somewhere it should not have**: **Rotate token**. The old one
stops working immediately and the new one is pushed to their engine in the same
action. A shared token cannot be revoked per person, so rotating is the only
revocation there is.

## 4. Back up the encryption key

**Encryption key** → **Show the key** → store it somewhere outside this system,
then mark it backed up.

The control plane holds a sealed copy so the clinic can be rebuilt, but that
copy is only as durable as the control plane's own `MASTER_KEY`. If both are
lost, the clinic's records are unreadable permanently. There is no recovery
path, by construction.

---

## What the clinic can and cannot do on day one

**Works immediately**: the console, lead capture and qualification through the
chat widget, appointment tracking, the retention and no-show logic, the audit
trail, and the voice agent once VAPI is pointed at their server URL.

**Needs configuration before it does anything visible**:

- **SMS.** Twilio credentials plus A2P 10DLC carrier registration, which takes
  weeks. Until then every reminder and reactivation message is composed,
  audited, and discarded. Tell the clinic this rather than letting them discover
  it — "the texts are not going out yet, here is when they will" is a very
  different conversation before signature than after.
- **A real calendar.** Without Google Calendar credentials, bookings live in the
  engine's internal scheduler and never appear on the practice calendar.
- **A language model.** New clinics default to `LLM_PROVIDER=none`, the
  deterministic rule engine. Everything works; the wording is less fluent.
  Enabling a vendor means arranging a BAA first — the Gemini Developer API is
  not covered by one.

## What to tell them about their data

Worth being able to answer, because a med spa will ask:

- Their records live in their own database, on their own volume, encrypted with
  a key no other clinic has.
- You hold a sealed copy of that key so their clinic can be rebuilt. You cannot
  read their patient records without going through their engine, and every
  administrative action against their clinic is recorded.
- If they stop paying, their engine is switched off and **nothing is deleted** —
  the database, the volume and every record stay exactly where they are, and it
  comes back when billing resumes.
- If they leave, their data is theirs. Take a `pg_dump` of their Postgres and
  hand it over with their encryption key.
