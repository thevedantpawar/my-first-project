# Microns marketing site (redesign)

Static, no build step. `index.html` is the full self-contained landing page — all CSS/JS inline,
the only external requests are Google Fonts (**Sora** for display, **Manrope** for body).
Design system matches the newer MICRONS/Lovable direction: warm-ivory OKLCH palette, deep-burgundy
`oklch(40% .098 12)` primary, dusty-rose `oklch(63% .072 16)` accent, `.5rem` radii.

## Files

| File | Purpose |
|---|---|
| `index.html` | The landing page |
| `privacy.html` / `terms.html` | Branded legal pages (template copy — review with counsel) |
| `404.html` | Branded not-found page |
| `sitemap.xml` / `robots.txt` | SEO |

The single-page also serves Privacy/Terms as hash routes (`/#/privacy`, `/#/terms`) for the
artifact/preview; the deployed footer links point at the real `.html` files.

## Preview

```bash
cd "microns/apps/website"
python -m http.server 4173   # http://localhost:4173
```

## Deploy to Railway

This folder is deploy-ready: `server.js` (zero-dependency Node static server — maps `/`,
extensionless paths, and a real `404.html`), `package.json` (`npm start`), `railway.json`.

**Option A — Railway CLI (no GitHub needed):**

```bash
npm i -g @railway/cli
railway login
cd microns/apps/website
railway link            # choose the "microns-site" project
railway up --service microns-website   # creates the service + deploys this dir
railway domain          # prints the public URL
```

**Option B — GitHub + Railway:** push this folder to its own repo, then in Railway add a
new service in the `microns-site` project from that repo (root dir `/` if the repo is just
this folder). `railway.json` is picked up automatically.

The existing `web` service (Next.js, repo `thevedantpawar/my-first-project` at `microns-site/`,
domains `micronsai.com` / `www.micronsai.com`) is separate — deploy this as a **new** service
first, verify, then repoint the custom domain when ready.

Update `<link rel="canonical">`, `og:image`, `sitemap.xml` and `robots.txt` URLs when the
final domain is decided.

## Still to wire (functionality / launch prep)

1. **Audit form → real backend.** `#auditForm` validates client-side, stores to `localStorage`
   as a stopgap, and shows a confirmation. To make it save + notify:
   - Point it at an endpoint: replace the `submit` handler's `TODO` with
     `fetch('/api/audit-request', { method:'POST', body:new FormData(form) })`.
   - Add the route in `microns/apps/api` (Express is already there): persist the lead, then
     send yourself an email (Resend/Postmark/SES). Fields posted: `name, spa, location, email,
     phone, monthlyLeads, gap`.
   - Or drop in a Cal.com / Calendly inline embed in place of the form for direct booking.
2. **Real contact details.** `hello@microns.ai` is a placeholder throughout (footer, legal
   pages). Add a phone number and the booking link once they exist.
3. **`og:image`.** Currently points at `/og.png` (not yet created) — add a 1200×630 share image.
4. **Mobile QA.** Built responsive (hero visual stacks, flows go vertical, pricing stacks,
   sticky bottom CTA). Verify once more at 390px on a real device.
5. **Analytics + JSON-LD.** `Organization`/`ProfessionalService` JSON-LD is in `<head>`;
   add a `LocalBusiness` block with real address/phone when available, plus analytics.

## Note on "social proof"

The design brief explicitly forbids fabricated testimonials, logos, client counts, and results.
Instead of a fake testimonial block, the page has **"The numbers we watch"** (`#results`) —
the operational metrics baselined in the audit and tracked once live. Swap in real,
permission-cleared client quotes or anonymized before/after numbers when you have them.
