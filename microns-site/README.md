# Microns — marketing site

Five routes, no more: `/`, `/systems`, `/about`, `/book`, `/audit`.
Next.js (App Router) + TypeScript + Tailwind v4. No component library — the
primitives are in `src/components/ui.tsx` so the design isn't shape-limited by
someone else's defaults. Deploy target: Vercel.

The design plan and its self-critique are in `../docs/design-plan.md`.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

## Before launch — the things only you can fill in

Everything below lives in `src/content/site.ts` or `.env`. Nothing else needs
editing.

| What | Where | Status |
|---|---|---|
| Domain | `site.domain`, `NEXT_PUBLIC_SITE_URL` | placeholder `microns.studio` |
| Surname and city | `site.founder` | surname guessed, city empty (the sentence omits it while empty) |
| Contact email | `site.founder.email` | placeholder |
| Price range and monthly | `site.pricing` | **placeholder — $2,000–$6,000 build, $350/month.** Replace with numbers you can defend on a call |
| Booking link | `NEXT_PUBLIC_BOOKING_URL` | unset — `/book` shows the email fallback until you add a Cal.com or Calendly URL |
| Audit webhook | `AUDIT_WEBHOOK_URL` | unset — submissions are logged server-side until you point this at n8n |
| Analytics | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | unset — no script loads until you set it |
| The "why med spas" paragraph | `src/app/about/page.tsx` | written as an argument, not a personal story. Rewrite it in your own words |

## Conversion tracking

Both CTAs are tagged for Plausible's tagged-events script, so you can tell the
two paths apart:

- `Book call` — every `Book a 20-minute call` button, the header button and the
  mobile sticky bar.
- `Audit request` — the audit form submit and the link from the home page.

## Checks

```bash
npm run build && npm start        # then, in another shell:
node scripts/checks.mjs           # fold, overflow, tap targets, focus, forms, metadata
node scripts/shot.mjs "/,/audit"  # screenshots at 390 and 1280
```

Last run, on all five pages at mobile: Lighthouse performance 98–99,
accessibility 100, CLS 0.

## Rules this site is built to

- No fabricated proof. No testimonials, no client logos, no invented numbers.
  Where a logo wall would go, the audit's own checklist goes instead.
- Every claim is self-evidently true, marked as an illustration, or absent. The
  hero timeline is captioned as an illustration for exactly this reason.
- One accent colour, one display weight, one radius behaviour (none).
- `prefers-reduced-motion` disables the hero sequence completely.
