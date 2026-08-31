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
| Domain | `site.domain`, `NEXT_PUBLIC_SITE_URL` | `micronsai.com` — attached on Railway, DNS pending |
| City | `site.founder.city` | empty — the sentence omits it while empty |
| Contact email | `site.founder.email` | `ved@micronsai.com` |
| Price range and monthly | `site.pricing` | $1,500–$3,000 build, $750/month |
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

## Preview deploy (Railway)

Project `microns-site` → service `web`, in Vedant Pawar's Railway workspace.

- URLs: https://micronsai.com and https://www.micronsai.com (custom domains
  attached; DNS records still to be created), plus the Railway domain
  https://web-production-945bf9.up.railway.app

  DNS records to create at the registrar, both CNAME:

  | Host | Target |
  |---|---|
  | `@` (apex) | `m54h4frr.up.railway.app` |
  | `www` | `h3549x6b.up.railway.app` |

  If the registrar will not take a CNAME at the apex, use one that supports
  CNAME flattening (Cloudflare, Namecheap, Gandi) or point the apex at `www`.
- Built from `microns-site/Dockerfile`; service root directory is `microns-site`.
- Start command is `npm run start:railway` (`next start -H 0.0.0.0`). It must not
  be `next start -p $PORT` — Railway execs the start command without a shell, so
  `$PORT` arrives literally and the container crash-loops. Next.js reads `PORT`
  from the environment on its own.
- The service's connected branch has drifted back to another branch more than
  once. If a deploy fails at BUILD_IMAGE within ~10 seconds, that is the cause:
  re-pin the source to `claude/website-build-sections-xvk8f6` and redeploy.

## Checks

```bash
npm run build && npm start        # then, in another shell:
node scripts/checks.mjs           # fold, overflow, tap targets, focus, forms, metadata
node scripts/shot.mjs "/,/audit"  # screenshots at 390 and 1280
```

Last run, on all five pages at mobile: Lighthouse performance 98–99,
accessibility 100, CLS 0.

## Imagery

The visual beside each system, and the one on the home page, is a mockup of the
message the client actually receives — `src/components/system-visual.tsx`,
driven by the `visual` field on each system in `src/content/copy.ts`. It is
deliberately not stock photography: it shows the product, it is specific, and
every instance is captioned as an illustration.

## Logo

`src/components/logo.tsx` is the on-site lockup: the micron scale with one
graduation in the accent blue, beside the wordmark in Instrument Serif.
Standalone files for decks and email signatures are `public/microns-mark.svg`
and `public/microns-mark-reversed.svg` (for dark backgrounds). The wordmark is
live text, so if you need a fully self-contained logo file, have the type
outlined from Instrument Serif.

## Rules this site is built to

- No fabricated proof. No testimonials, no client logos, no invented numbers.
  Where a logo wall would go, the audit's own checklist goes instead.
- Every claim is self-evidently true, marked as an illustration, or absent. The
  hero timeline is captioned as an illustration for exactly this reason.
- One accent colour, one display weight, one radius behaviour (none).
- `prefers-reduced-motion` disables the hero sequence completely.
