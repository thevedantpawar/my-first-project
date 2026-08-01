# Ashirwad Wellness

An online pharmacy and wellness commerce platform for **Ashirwad Medical**, a licensed
retail pharmacy in Nashik, Maharashtra.

The platform is architected around Indian pharmacy regulation. Prescription gating is
not a feature layered on top of a storefront — it is the spine of the data model, and
it is enforced in the database, not in the UI.

**Status: Phase 2 (catalogue and discovery) complete.**

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
| `npm test` | Vitest — compliance logic and seeded-catalogue checks |
| `npm run test:constraints` | SQL suite proving the DB-level guarantees |

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

The database stores an **opaque storage key only** (`Prescription.imageKey`). Never a
URL, never a public path, nowhere in the schema. Reads go through a server action that
mints a short-lived signed URL (default 300s) and writes a `PRESCRIPTION_VIEWED` audit
row. The bucket must be private. Health-record uploads get identical treatment.

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
footer via `src/components/site-footer.tsx`, and will render on checkout in Phase 3.

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

## Verification

Compliance claims in this README are tested, not asserted.

```bash
npm test                   # 53 tests
npm run test:constraints   # 14 database-level cases
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
  components/
    rx-gate.tsx            The Rx Gate — the signature element
    product-card.tsx       Catalogue card (Rx Gate surface 1)
    salt-substitutes.tsx   Cheaper same-composition equivalents
    search-box.tsx         Autocomplete combobox
    catalogue-filters.tsx  URL-driven filter rail
    product-image.tsx      Imagery with deterministic fallback
    site-header.tsx        Navigation + search
    site-footer.tsx        Statutory disclosure
    trust-strip.tsx        Licence numbers above the fold
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
| `--living` `#2D8F5F` | CTAs, active states, in-stock |
| `--turmeric` `#E8A317` | Offers, savings, urgency |
| `--rx` `#B3261E` | **Prescription signalling only** |
| `--paper` `#F7F5F0` | Page background |
| `--ink` `#141A17` | Primary text |

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
- [ ] **Phase 3** — Cart, prescription upload, server-side Rx gate, checkout
- [ ] **Phase 4** — Customer account, order history, prescription library
- [ ] **Phase 5** — Pharmacist verification queue, admin portal
- [ ] **Phase 6** — Rate limiting, Playwright suite, SEO, Lighthouse

---

## Before this goes live

1. Replace every `REPLACE_ME_*` value with Ashirwad Medical's real registered details.
2. Set `PHARMACIST_REG_NO` on the pharmacist account — H1 verification is blocked
   without it, by design.
3. Confirm the prescription bucket is private and not publicly listable.
4. Replace the stubbed OTP provider; it throws in production by design.
5. Have a registered pharmacist review the seeded catalogue's schedule classifications
   before any of it is dispensed against.
