# Ashirwad Wellness

An online pharmacy and wellness commerce platform for **Ashirwad Medical**, a licensed
retail pharmacy in Nashik, Maharashtra.

The platform is architected around Indian pharmacy regulation. Prescription gating is
not a feature layered on top of a storefront — it is the spine of the data model, and
it is enforced in the database, not in the UI.

**Status: all six phases complete.** Foundation, catalogue, cart and checkout, customer
account, pharmacist portal and admin, hardening.

---

## Setup

Requires Node 20+ and PostgreSQL 14+.

```bash
npm install

# Create the database
createdb ashirwad_wellness

cp .env.example .env       # then fill it in — see "Environment" below
npm run db:migrate         # applies schema + compliance constraints
npm run db:seed            # 86 products, 3 users, 16 pincodes

npm run dev                # http://localhost:3000
```

### Seeded accounts

All use the password `Ashirwad@2026`.

| Email | Role |
|---|---|
| `admin@ashirwadwellness.in` | ADMIN |
| `pharmacist@ashirwadwellness.in` | PHARMACIST |
| `customer@example.invalid` | CUSTOMER |

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply migrations (dev) |
| `npm run db:deploy` | Apply migrations (production, non-interactive) |
| `npm run db:seed` | Seed catalogue and reference data |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm test` | Vitest — Rx gate, compliance, search, pricing, rate limits |
| `npm run test:constraints` | SQL suite proving the DB-level guarantees |
| `npm run test:e2e` | Playwright — the compliance flows, through a browser |
| `npm run test:all` | All three, in order |

---

## Environment

Every variable is documented in `.env.example`. Three groups matter most.

**Database** — `DATABASE_URL`. Prisma 7 reads this via `prisma.config.ts`; the
runtime client uses the `@prisma/adapter-pg` driver adapter.

**Regulatory identifiers** — `PHARMACY_DL_NO_20B`, `PHARMACY_DL_NO_21B`,
`PHARMACY_FSSAI_NO`, `PHARMACY_GSTIN`, `PHARMACIST_NAME`, `PHARMACIST_REG_NO` and
others. These render in the site footer and on checkout.

> The placeholder values shipped in `.env.example` are deliberately malformed
> (`REPLACE_ME_…`). They are **not** valid licence numbers and are not formatted like
> real ones, so a half-configured deploy fails loudly rather than publishing a
> plausible-looking fake. `assertRegulatoryIdentityConfigured()` throws in production
> when any remain unset, and the footer renders "Not configured" in warning colour.
> **No regulatory identifiers have been invented anywhere in this codebase.**

**Private storage** — `S3_BUCKET_PRESCRIPTIONS` and credentials. This bucket must be
private. Prescription images are sensitive personal data; see below.

---

## Compliance notes

These come from the Drugs and Cosmetics Act 1940 / Rules 1945, the Pharmacy Act 1948,
the NDPS Act 1985, and the Drugs and Magic Remedies (Objectionable Advertisements)
Act 1954. Each is enforced in code. Where a rule could be enforced at the database
level, it is — on the assumption that the application layer will eventually be
bypassed by a script, a migration, or a future contributor.

### 1. Schedule type drives everything

Every product carries a `scheduleType`: `OTC`, `SCHEDULE_H`, `SCHEDULE_H1`,
`AYURVEDIC`, `COSMETIC`, `NUTRACEUTICAL`, `DEVICE`.

`Product.requiresPrescription` is **derived** from it, and a CHECK constraint pins the
relationship:

```sql
CHECK ("requiresPrescription" = ("scheduleType" IN ('SCHEDULE_H','SCHEDULE_H1')))
```

The Rx gate reads this column. If it could drift from `scheduleType`, the gate would
be a lie. The constraint makes drift impossible rather than unlikely — including via a
direct `psql` UPDATE. `src/lib/schedule.ts` is the single source of truth in
application code, and no other file may hardcode the list of Rx schedule types.

### 2. Schedule X, narcotics and psychotropics cannot be listed

Three independent layers:

1. **The enum has no member for them.** They are unrepresentable by construction.
2. **A CHECK constraint** pins the permitted set. This is deliberately redundant: it
   means a future `ALTER TYPE … ADD VALUE` cannot silently make controlled substances
   listable without someone also dropping the constraint and explaining why.
3. **A `BannedSubstance` trigger** catches the realistic attack — not listing
   pentazocine honestly, but listing it tagged as `OTC`. The trigger matches product
   name and composition on both INSERT and UPDATE.

The banned list is seeded with the habit-forming members of the Schedule H1 list
(alprazolam, diazepam, codeine, tramadol, pentazocine, buprenorphine, zolpidem and
others) plus NDPS substances and banned fixed-dose combinations. **H1 status alone
does not make a drug listable** — the anti-infective H1 items in the catalogue are
dispensable online, the psychotropic ones are not.

### 3. The Schedule H1 register is append-only

Rule 65(11A) requires a register, not a spreadsheet. `ScheduleH1Register` captures
prescriber name and registration number, patient name, drug, quantity, batch, expiry
and the dispensing pharmacist's name and registration number.

DB triggers reject `UPDATE`, `DELETE` and `TRUNCATE`. Rewriting history requires
dropping a trigger, which is itself a schema change with a paper trail. Genuine errors
are corrected by **inserting** a new row pointing at the erroneous one via
`correctsEntryId`, which a CHECK constraint requires to carry a stated reason.

Every column is a **snapshot** taken at dispensing time — not a live join to a mutable
row. The register stays truthful even if the product is repriced or the user renamed.

### 4. Audit log is immutable

`AuditLog` records actor, role, action, entity, timestamp, IP and user agent, with
structured `metadata` for before/after detail. Same append-only trigger treatment as
the H1 register. There is deliberately no update or delete helper in
`src/lib/audit.ts`, and adding one would not work.

`audit()` never throws — losing an order is worse than losing a log line — but failures
are logged loudly. `auditInTransaction()` is available where the log entry must not
survive a rolled-back action.

### 5. Prescription images are sensitive personal data

The database stores an **opaque storage key only** (`Prescription.imageKey`) — a UUID,
so knowing a customer's id reveals nothing about their prescription paths. Never a URL,
never a public path, nowhere in the schema.

Reads go through a server action that mints a short-lived signed URL (default 300s) and
writes a `PRESCRIPTION_VIEWED` audit row naming who looked. The signature covers the key
*and* the expiry, so neither can be edited without invalidating it.

A signed URL is necessary but **not sufficient**: `/api/private-file` independently
re-establishes that the caller is signed in and is either the record's owner or a
pharmacist/admin. A link pasted into a group chat is useless to anyone else. Health
records get the same treatment except that pharmacists cannot read them — a lab report
is not a pharmacist's business.

In production the local-disk driver refuses to run at all: prescription images must go
to configured private object storage, not the application filesystem.

### 6. No therapeutic claims on nutraceuticals, cosmetics or ayurvedic products

`src/lib/claims.ts` runs at the product write boundary, so non-compliant copy cannot be
saved — not merely flagged on a dashboard someone reads later. It flags `cure`, `treat`,
`prevent`, `heal`, `remedy`, efficacy guarantees, absolute safety claims, unsubstantiated
endorsements, and named disease conditions.

Drugs are exempt: a medicine must be able to state what it treats.

`tests/catalogue-compliance.test.ts` runs the linter over the **actual seeded
catalogue**, so the seed cannot drift into non-compliance unnoticed.

### 7. Statutory disclosure

Drug licence numbers (Form 20B and 21B), FSSAI licence, GSTIN, and the registered
pharmacist's name and State Pharmacy Council registration number render in the site
footer via `src/components/site-footer.tsx`, on the checkout page, on the order
confirmation page, and in the footer of every transactional email.

Unset values render visibly as "Not configured" in warning colour, with a banner
stating the deployment is not ready to accept orders. A footer that quietly omits a
missing drug licence number is worse than one that says it is missing.

### 8. Serviceability is allow-list only

`ServiceablePincode` is an allow-list. A pincode absent from the table is not
serviceable — there is no default-open path. Dispensing is tied to licensed premises,
so the seed covers Nashik district only.

### 9. Money is integer paise

No floats touch a price, a tax figure, or a total, anywhere. `src/lib/money.ts` is the
only place rounding happens. GST is stored as basis points (`1200` = 12%) and
CHECK-constrained to the real Indian slabs (0, 5, 12, 18, 28%). Indian pharmacy pricing
is inclusive-of-tax, so `gstComponentPaise()` extracts the tax from the line total
rather than adding it on top.

### 10. Assume the client is hostile

Middleware (`src/middleware.ts`) does **routing**, not authorisation, and says so in a
comment. Real enforcement is `requireUser` / `requireRole` / `requirePharmacist` in
`src/auth.ts`, which re-read the role from the database on every privileged action, so
a revoked pharmacist cannot keep dispensing on a still-valid JWT.

`requirePharmacist()` additionally refuses if the pharmacist has no registration number
on file, because that value is stamped onto the statutory H1 register.

---

## Catalogue and search

**Salt-based search.** Customers arrive knowing either the brand the doctor wrote or
the molecule. Searching `paracetamol` surfaces Crocin, Dolo, Calpol, Pacimol and
Paracip — none of which has the word in its name. Searching `cefixime` surfaces Zifi,
Taxim-O and Mahacef.

**Typo tolerance** via `pg_trgm`. `azithromicin`, `cetrizine`, `pantaprazole`,
`telmisartin` and `amoxycillin` all resolve. Autocomplete offers salts and brands
above individual products, because those are the broader query.

**Weak-tail suppression.** Drug names are deliberately similar — cefixime and
cefpodoxime are a few trigrams apart. When a strong match exists, results scoring
below 60% of the best are dropped, so a `cefixime` search never quietly includes a
cefpodoxime product. When *nothing* matches strongly the tail is kept, because then
the near-misses are the entire value of the search. Both behaviours are pinned by
tests.

**Salt substitutes.** The product page lists cheaper equivalents, matched on
`saltKey` — the normalised, sorted salt fingerprint. Two safety properties hold in
`getSaltSubstitutes`, not in the view:

- A combination drug only matches the *same* combination at the *same* strengths.
  Paracetamol 650 mg is never offered as a substitute for Paracetamol 500 mg.
- Schedule type must match. A Schedule H drug is never presented as swappable for an
  OTC one, whatever the composition.

Substitutes carry the Rx Gate with them, so a prescription-only alternative is still
visibly prescription-only in the recommendation list.

**Filter state lives in the URL**, so a filtered catalogue view is shareable and
survives the back button. Params are validated with Zod and a malformed value
degrades to no filter rather than a 500.

---

## The Rx gate

`src/lib/rx-gate.ts` is the enforcement point. Everything visual — the ℞ badge, the
tinted card, the notice at checkout — tells an honest customer what will happen. This
is what actually happens.

Every Schedule H / H1 line must satisfy all five:

1. A prescription is linked to the line.
2. It belongs to the customer placing the order.
3. Its status is `VERIFIED` — set only by a pharmacist, never by a customer.
4. It has not expired.
5. Its dispensing budget is not exhausted (`refillsAllowed` repeats *in addition to*
   the original supply, as a prescriber writes it).

The gate runs **inside the order transaction**, so two concurrent checkouts cannot each
see the same last repeat available and both consume it. The dispensing count is derived
from `OrderItem` rather than read from a counter, so it cannot drift;
`Prescription.refillsUsed` is a display mirror, and where the two disagree the derived
figure wins. A cancelled or pharmacist-rejected order releases the supply, because it
never dispensed anything.

### Why an order still needs pharmacist review after passing the gate

The gate proves a *verified* prescription is attached. Only a pharmacist can confirm it
covers **these** drugs at **these** quantities. Orders containing Rx items are created
in `PENDING_PHARMACIST_REVIEW` regardless of payment state. The two checks are not
redundant.

### Bypass attempts, all tested

`tests/rx-gate.test.ts` calls the enforcement path directly — no browser, no form, no
client validation in the way, because that is what an attacker does.

| Attempt | Result |
|---|---|
| Schedule H or H1 line with no prescription | refused |
| Prescription in any non-`VERIFIED` state | refused |
| Another customer's genuinely verified prescription | refused |
| Fabricated prescription id | refused |
| Expired prescription | refused |
| Repeats exhausted | refused |
| Mixed cart where only the OTC line is covered | refused |
| Exactly `refillsAllowed + 1` supplies | allowed, the next one refused |
| Cancelled order consuming a repeat | supply released |

Verified end to end in a browser as well: the checkout button is disabled, **and**
navigating directly to `/checkout` redirects back to the cart, **and** the database
`CHECK` constraint refuses to strip the prescription from a dispensed H1 line even via
direct SQL.

### Order placement

`placeOrder` is a public HTTP endpoint and treats itself as one. Recomputed
server-side from the database, never read from the caller: prices, GST, totals, the
COD ceiling, pincode serviceability, and stock. Stock is decremented with a conditional
`updateMany`, so two orders cannot oversell the last unit. The delivery address is
snapshotted onto the order, so later edits to the address book cannot rewrite where a
dispensed order was sent.

---

## Pharmacist portal and admin

### Separation of duties

An administrator cannot verify a prescription, write to the Schedule H1
register, or release an order held for pharmacist review. Those are dispensing
decisions and belong to a registered pharmacist under the Pharmacy Act.
`updateOrderStatus` refuses outright when an order is in
`PENDING_PHARMACIST_REVIEW`, and the admin layout says so on every page.

Conversely, `requirePharmacist` refuses every verification until a registration
number is on file, because that number is stamped onto the register. An admin
sets it in **Staff**, and until then the pharmacist portal shows a blocking
banner rather than a form that would fail on submit.

### Two decisions, deliberately separate

1. **Prescription verification** — is this genuine, legible and in date? The
   pharmacist re-enters the prescriber's name and registration number *from the
   image* rather than accepting what the customer typed, because those values
   are copied verbatim into the register. Outcome is `VERIFIED`, `REJECTED`, or
   `CLARIFICATION_REQUESTED` (recoverable — the customer can re-upload).
   Verification also sets the validity window and repeat budget.

2. **Order review** — does that verified prescription cover *these* drugs at
   *these* quantities? Only a pharmacist can answer that, which is why passing
   the Rx gate at checkout is not the end of the process.

Terms cannot be changed once a prescription has been dispensed against — that
would retroactively alter what an earlier order was permitted to do.

### Writing the Schedule H1 register

Approving an order writes one `ScheduleH1Register` entry per Schedule H1 line,
**in the same transaction as the status change**, so an approved H1 order with
no register entry is not a reachable state. Batch number and expiry are required
per line and are read off the pack being dispensed; they are written back onto
the order item too, so the invoice and the register cannot disagree.

Approval re-checks that every Rx line still holds a `VERIFIED` prescription. The
gate ran at checkout, but a prescription can be rejected in between.

Serial numbers come from a Postgres sequence and may contain gaps where a
transaction rolled back. Gaps are correct; collisions would not be.

### Corrections

The register table rejects `UPDATE`, `DELETE` and `TRUNCATE`, through the ORM
as well as through raw SQL. A correction is a **new row** pointing at the one it
corrects, carrying a stated reason (CHECK-enforced), and the original stays
visible in the register marked as superseded.

A partial unique index enforces the real rule — at most one *original* entry per
dispensed item — rather than a blanket unique on `orderItemId`, which would have
made corrections impossible.

The register also pins its own evidence: an order item referenced by an entry
cannot be deleted, so a dispensed order cannot be tidied away.

### Compliance gates on product writes

`saveProduct` runs four gates before touching the database, and
`importProductsCsv` runs **the same four** — a bulk path that skipped them would
be the obvious way to get a banned substance into the catalogue.

1. Schedule type must be one the platform may list.
2. Name and composition must not match a `BannedSubstance`.
3. Copy must be free of therapeutic claims for claim-restricted classes.
4. `requiresPrescription` is derived, never read from the form.

Rejections are audited with the attempted values. CSV import is all-or-nothing:
if any row fails, nothing is written.

Products are **delisted**, never deleted — a product referenced by a dispensed
order must remain resolvable. Delisting also clears it from every live cart.

---

## Customer account

### Order history and the tax invoice

An order's detail page shows the dispensing timeline as it actually happened —
placed, held for pharmacist review, approved or declined with the pharmacist's
stated reason, dispensed. Rx lines carry the Rx Gate here too, and once approved
they show the batch number and expiry that went onto the register, because a
patient is entitled to know which pack they were dispensed.

`src/lib/invoice.ts` renders a **GST tax invoice** as a PDF: both drug licence
numbers, FSSAI licence, GSTIN, and the registered pharmacist's name and
registration number; per line the HSN code, GST rate, taxable value and tax; and
for Rx lines the batch, expiry and the prescribing doctor's registration number.
Amounts come from the order's stored paise figures, never recomputed at render
time — an invoice must show what was charged, not what today's prices would be.

The route scopes the lookup by `userId` in the query itself. An order number is
short and guessable, and must never be sufficient on its own to read someone
else's invoice.

### Reordering

`reorder` rebuilds a cart from a past order rather than copying it. Delisted and
out-of-stock items are skipped and named, quantities are re-clamped to the
current `maxPerOrder` and stock, and **prescription links are not carried over**.
A repeat of an Rx order goes back through the gate and back through pharmacist
review; the previous approval covered the previous dispensing.

### Prescription library

Every prescription the customer has uploaded, with its status, validity window,
verifying pharmacist and remaining repeats. The repeat count is **derived from
dispensed order items**, exactly as the gate derives it — not read from the
`refillsUsed` mirror — so the customer is never shown a supply the gate would
refuse. Images open through the same signed-URL path as the pharmacist
portal — a fresh short-lived URL, minted server-side, audited on every view.
Rejected prescriptions show the pharmacist's reason so the customer knows what
to fix, and `CLARIFICATION_REQUESTED` offers a re-upload.

### Family profiles and health records

Orders may be placed for a named family member, which matters because the H1
register records the **patient's** name, not the account holder's. Health records
are stored with the same private-storage treatment as prescriptions, with one
difference: pharmacists cannot read them. A lab report is not a dispensing
record.

---

## Hardening

### Rate limiting

`src/lib/rate-limit.ts` is an interface with an in-process fixed-window counter
as the default. That default is honest about what it is: it does not survive a
restart and does not coordinate across instances, so a multi-instance deployment
must register the Redis implementation at the same seam.

| Surface | Limit |
|---|---|
| Sign-in | 8 / 15 min |
| Prescription upload | 12 / hour |
| Health record upload | 20 / hour |
| Checkout | 10 / 10 min |
| Search | 120 / min |

When the client IP cannot be determined the key falls back to a constant, which
makes the limit global rather than per-client — **degrading closed, not open**.

`RATE_LIMIT_DISABLED=true` exists for the E2E suite, which signs in on nearly
every spec. It throws if `NODE_ENV=production`, so it cannot be left on by
accident in a deploy.

### SEO and structured data

Canonical URLs, OpenGraph and Twitter cards, `robots.ts` and `sitemap.ts`.
JSON-LD: `Product` with price and availability on product pages,
`BreadcrumbList` on catalogue paths, and `Pharmacy` on the storefront carrying
the drug licence and the registered pharmacist.

Two rules the code enforces rather than trusts:

- `siteUrl()` **throws in production** when `NEXT_PUBLIC_SITE_URL` is unset. A
  sitemap full of `http://localhost:3000` is worse than a failed boot.
- Unconfigured regulatory identifiers are **omitted** from JSON-LD, never
  emitted as `REPLACE_ME_…`. Structured data asserting a fake licence number is
  worse than structured data that is merely incomplete.

`robots.txt` disallows `/account`, `/admin`, `/pharmacist`, `/checkout` and
`/cart`, and the sitemap never lists them. Both are asserted in the E2E suite.

### End-to-end suite

`e2e/` drives a real browser against a real database. It runs serially against
the dev server, because the local-disk storage driver deliberately refuses to
run under `NODE_ENV=production` — that refusal is a feature, so the suite works
with it rather than around it.

| Spec | Proves |
|---|---|
| Rx gate, no prescription | Cart explains, button disabled, **and `/checkout` redirects back** |
| Rx gate, unverified prescription | An uploaded-but-unverified prescription is not offered and does not open the gate |
| Rx gate, after verification | Pharmacist verifies → gate opens → order lands in `PENDING_PHARMACIST_REVIEW` |
| Pharmacist approval | Batch and expiry are mandatory; approval writes exactly one H1 register entry carrying both registration numbers; the register then refuses `UPDATE` |
| Pincode | An unserviceable pincode blocks the rest of the address form |
| COD ceiling | Cash on delivery is withdrawn, and disabled, above the ceiling |
| Role boundaries | A customer reaches neither the pharmacist portal nor admin; an admin cannot release an order held for review; the audit viewer offers no mutation |
| Statutory surfaces | Licence numbers in the footer; `Product` and `BreadcrumbList` JSON-LD; robots and sitemap exclude private routes |
| Quality floor | No horizontal scroll at 360px; one `h1`; a working skip link |

Every fixture is built **through the application** — upload, verification,
linking, checkout — so an order under test is one the Rx gate genuinely let
through, not a row inserted behind the app's back.

Two things the suite learned the hard way, both documented in `e2e/helpers.ts`:
`page.waitForURL` hangs on App Router soft navigations because there is no
`load` event, so route changes are awaited by polling `location.pathname`; and a
server-rendered button is present *and enabled* long before React attaches its
handler, so `clickUntilEffect` clicks and then checks whether the click did
anything, rather than trusting "enabled" to mean "live".

### Lighthouse

Measured against a **production build** (`next build && next start`), desktop
preset. Dev-server numbers are meaningless — unminified bundles and on-demand
compilation.

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/` | 100 | 100 | 100 | 100 |
| `/category/medicines` | 100 | 100 | 100 | 100 |
| `/product/zifi-200-tablet` | 100 | 100 | 100 | 100 |

Three real defects surfaced getting there, all now fixed at the source:

- **Contrast.** `--ink-300` sat at 3.02:1, and `--turmeric-600` at 3.00:1 on the
  savings chip. Both now clear 4.5:1 on *every* surface they land on, including
  the Rx-tinted product card — tuning `--ink-300` against paper alone still left
  it failing at 4.39:1 on `rx-50`, which is the card where the small print
  matters most.
- **White on `--living`.** The brand green reaches only 3.70:1 under white text,
  so solid buttons now use `living-600` with a `living-700` hover. `--living`
  itself is unchanged and still carries active states, the in-stock dot and
  accents — everywhere it is not being asked to sit under text.
- **A 404 per catalogue tile.** The seed pointed every product at
  `/products/<slug>.jpg`, which does not ship. `ProductImage`'s monogram
  fallback hid it visually, so it cost a wasted request per card and a console
  error rather than a visible break. The seed now stores no image URL until
  there is a real photograph.

The Rx card was re-measured after the token changes. On `rx-50`: the product
name 15.70:1, the ℞ label and notice 8.11:1, the rule and chip 5.82:1, the small
print 5.73:1. The prescription signal sits above everything except the product
name itself, and clears AA with room — which is what it is for.

---

## Verification

Compliance claims in this README are tested, not asserted.

```bash
npm test                   # 96 tests
npm run test:constraints   # 14 database-level cases
npm run test:e2e           # 14 browser flows
```

`prisma/sql/constraint_tests.sql` proves the guarantees hold against a real Postgres:

| # | Case | Expected |
|---|---|---|
| 1–2 | `requiresPrescription` desynced from `scheduleType`, both directions | rejected |
| 3–4 | Banned substance listed as OTC, on INSERT and on UPDATE | rejected |
| 5–6 | Selling price above MRP; non-existent GST slab | rejected |
| 7 | Coupon with both percentage and flat discount | rejected |
| 8 | Prescription refills overdrawn | rejected |
| 9 | **Schedule H order line with no prescription attached** | **rejected by the database** |
| 10–12 | UPDATE/DELETE against the H1 register and audit log | rejected |
| 13 | Correcting H1 entry with no stated reason | rejected |
| 14 | Trigram search matches a misspelling | matches |

---

## Architecture

```
prisma/
  schema.prisma            25 models, 12 enums
  sql/compliance.sql       CHECK constraints + append-only triggers
  sql/constraint_tests.sql DB-level compliance proof
  seed.ts                  86 real products
src/
  auth.ts                  NextAuth v5 + server-side role enforcement
  auth.config.ts           Edge-safe half, for middleware
  middleware.ts            Role-based routing (not authorisation)
  lib/
    db.ts                  Prisma client + pg driver adapter
    catalogue.ts           Filters, sorting, facets, salt substitutes
    search.ts              Trigram search, autocomplete, salt lookup
    search-params.ts       Validated URL params -> filters
    labels.ts              Enum -> customer-facing label
    schedule.ts            Single source of truth for "prescription required"
    claims.ts              Therapeutic-claim linter
    banned-substances.ts   App-layer half of the Schedule X block
    audit.ts               Immutable audit trail
    pharmacy.ts            Statutory identity from env
    money.ts               Integer paise, GST, Indian formatting
    otp.ts                 Phone OTP behind an interface (stubbed)
    rx-gate.ts             THE enforcement point
    storage.ts             Private storage + HMAC-signed expiring URLs
    invoice.ts             GST tax invoice PDF
    rate-limit.ts          Fixed-window limiter behind an interface
    seo.ts                 Canonical origin, Pharmacy/Breadcrumb JSON-LD
  actions/
    cart.ts                Cart mutations + guest-cart reconciliation
    prescriptions.ts       Upload, link, signed-URL minting
    checkout.ts            placeOrder — recomputes everything server-side
    pharmacist.ts          Verification, order review, H1 register writes
    admin-products.ts      saveProduct + CSV import (same four gates)
    admin.ts               Orders, staff, serviceability
    account.ts             Profile, patients, health records, reorder
  app/
    account/               Orders, invoices, prescriptions, records, family
    pharmacist/            Verification queue and order review
    admin/                 Catalogue, orders, staff, audit viewer
    api/private-file/      Signed-URL reads, re-authorised independently
    robots.ts sitemap.ts   Private routes excluded from both
  components/
    rx-gate.tsx            The Rx Gate — the signature element
    product-card.tsx       Catalogue card (Rx Gate surface 1)
    salt-substitutes.tsx   Cheaper same-composition equivalents
    search-box.tsx         Autocomplete combobox
    catalogue-filters.tsx  URL-driven filter rail
    product-image.tsx      Imagery with deterministic fallback
    order-review-form.tsx  Batch/expiry capture for the H1 register
    prescription-library.tsx  Customer's prescriptions and their status
    site-header.tsx        Navigation + search
    site-footer.tsx        Statutory disclosure
    trust-strip.tsx        Licence numbers above the fold
e2e/                       Playwright: the compliance flows, in a browser
tests/                     Vitest: gate bypasses, claims, pricing, limits
```

### Stack notes

- **Next.js 15.5** — App Router, Server Components, TypeScript strict.
- **Prisma 7** — datasource URL lives in `prisma.config.ts`, not the schema, and the
  client requires a driver adapter. This differs from Prisma 6 tutorials.
- **Tailwind v4** — CSS-first. `@theme` in `src/app/globals.css` *is* the config;
  there is no `tailwind.config.ts`, which is correct for v4.
- **NextAuth v5 beta** — JWT sessions (required by the credentials provider) with the
  Prisma adapter persisting users and accounts.

One footgun worth knowing: `next/font` variables are declared on the element carrying
the font `className`, and a `var()` reference inside a custom property is substituted
using the element where that property is declared. Since `@theme` declares
`--font-display` on `:root`, the font classNames must go on `<html>` — putting them on
`<body>` leaves them undefined at `:root` and every font token silently falls back.

### Design

Tokens live in `src/app/globals.css`.

| Token | Use |
|---|---|
| `--pine` `#0F3D2E` | Primary, headers, trust surfaces |
| `--living` `#2D8F5F` | Active states, in-stock, accents |
| `--turmeric` `#E8A317` | Offers, savings, urgency |
| `--rx` `#B3261E` | **Prescription signalling only** |
| `--paper` `#F7F5F0` | Page background |
| `--ink` `#141A17` | Primary text |

The six above are the palette. Derived shades exist so components never hand-roll
an opacity, and two of them carry a rule worth knowing: **solid buttons use
`living-600`, not `--living`**, because white text on the brand green is 3.70:1
and fails WCAG AA; and **no token is lightened with `opacity`** — every pairing
in the interface is a real colour pair that has been measured. Reach for a
lighter token, not a lighter alpha.

Type: Bricolage Grotesque (display, restrained), Manrope (body), IBM Plex Mono
(identifiers — order numbers, licence numbers, batch numbers, dosage strengths), Noto
Sans Devanagari (Hindi product names).

**The Rx Gate** is the one place this design spends visual boldness: a 3px `--rx` left
rule, the ℞ chip, and the same sentence, rendered identically on the catalogue card,
product page, cart line and checkout line. `src/components/rx-gate.tsx` is the only
sanctioned way to signal a prescription item — do not fork it per surface. `--rx`
appears nowhere else in the application, which is what makes the colour itself
informative.

---

## Roadmap

- [x] **Phase 1** — Foundation, data model, compliance constraints, auth, seed
- [x] **Phase 2** — Catalogue, search, salt substitutes, product pages
- [x] **Phase 3** — Cart, prescription upload, server-side Rx gate, checkout
- [x] **Phase 4** — Customer account, order history, tax invoices, prescription library
- [x] **Phase 5** — Pharmacist verification queue, H1 register, admin portal
- [x] **Phase 6** — Rate limiting, Playwright suite, SEO and structured data

---

## Before this goes live

1. Replace every `REPLACE_ME_*` value with Ashirwad Medical's real registered details.
2. Set `PHARMACIST_REG_NO` on the pharmacist account — H1 verification is blocked
   without it, by design.
3. Confirm the prescription bucket is private and not publicly listable.
4. Replace the stubbed OTP provider; it throws in production by design.
5. Have a registered pharmacist review the seeded catalogue's schedule classifications
   before any of it is dispensed against.
