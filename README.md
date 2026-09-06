# MICRONS marketing site

Static reconstruction of the Lovable design (`aesthetic-nexus-systems.lovable.app`) — same
`styles-vcDe33lo.css`, fonts (Sora / Manrope), images and markup — served as plain HTML/CSS/JS
with a zero-dependency Node server. The 6 launch items are built in.

## Live

- **Deploy:** Railway service `microns-lovable-site` in project `microns-site`
- **URL:** https://microns-lovable-site-production.up.railway.app
- **Repo/branch:** `thevedantpawar/my-first-project` → branch `microns-static-site` (orphan branch, this folder only). Pushes auto-deploy.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page (generated — see "Rebuilding") |
| `assets/` | `styles-vcDe33lo.css`, `medspa-*.jpg`, `og-cover.jpg` (from the Lovable build) |
| `privacy.html` `terms.html` `404.html` | Branded, load the same stylesheet |
| `server.js` `package.json` `railway.json` | Deploy (Nixpacks → `npm start` → `node server.js`) |
| `sitemap.xml` `robots.txt` | SEO |

## The changes

1. **Audit form** — real form in `#audit` (name, med spa, location, email, phone, monthly leads,
   booking/CRM software, gap).
   Submits to a **Google Form** and reveals an inline **Calendly** widget. Also writes a local backup.
2. **Mobile** — hero card no longer `position:absolute` on small screens; sections reflow; slide-down
   mobile menu; sticky bottom "Get a free audit" bar. Verify once more on a real device at 390 px.
3. **Legal + 404** — `privacy.html`, `terms.html` (template copy — review with counsel), branded `404.html`.
   Linked in the footer.
4. **SEO** — `Organization`/`ProfessionalService` JSON-LD added (FAQ JSON-LD kept), real `og:image`
   (`/assets/og-cover.jpg`), canonical, `sitemap.xml`, `robots.txt`.
5. **Results** — `#results` section between Why Microns and Pricing: the anonymized Skin Alive
   consultation-booking build, framed as "what we built" + a qualitative outcome (no invented numbers).
6. **Contact / Calendly** — `calendly.com/vedantpawar3690/30min` wired to the hero-side "Pick a time now"
   button (popup), the footer "Book a call" link, and the post-submit inline widget.
7. **Analytics** — GA4 scaffolded and instrumented, dormant until you paste a Measurement ID.
   See "Analytics" below.
8. **Trust strip** (`#trust`) — slim band directly under the hero: founding-partner line plus four
   claims that are all independently true (US-only focus, clinical escalation, works around existing
   tooling, client approves messaging).
9. **Safety & compliance** (`#safety`) — sits between Proof of work and Pricing, and is linked from
   both navs. Every claim traces to the engine repo's `docs/SECURITY.md` ("Compliance status") and
   `README.md` ("Healthcare boundary"). It deliberately does **not** claim HIPAA certification or a
   signed BAA — those are deployment/configuration matters, not shipped guarantees. Ends with the
   "not a medical device / not a system of record" boundary statement.

## Analytics

`index.html` ships a GA4 block that is **inert until you give it an ID**. Open `index.html` (or
better, `scripts/build_site.py` → `ANALYTICS`) and set:

```js
window.MICRONS_ANALYTICS = { ga4: "G-XXXXXXXXXX" };
```

Get the ID from analytics.google.com → Admin → Data streams → Web. Until it is filled in, no
request is made to Google and no data leaves the page — `gtag` is still defined, so every event
call is a safe no-op that queues into `dataLayer`.

Events fired:

| Event | When | Parameters |
|---|---|---|
| `audit_form_start` | first focus into the audit form | — |
| `audit_form_submit` | audit form submitted | `monthly_leads`, `gap`, `software` |
| `cta_click` | any audit/Calendly CTA, incl. the sticky mobile bar | `cta_text`, `cta_section` |
| `calendly_open` | scheduler opened | `surface` = `popup` \| `inline_post_submit` |
| `demo_scenario` | demo tab switched | `scenario` |
| `faq_open` | an FAQ item opened | `question` |
| `scroll_depth` | 25 / 50 / 75 / 100% reached | `percent` |

**No PII is sent.** Name, clinic name, email and phone stay out of analytics entirely; only the
qualifying dropdown answers are reported.

## Wiring the Google Form

Edit `window.MICRONS_CONFIG` near the top of the inline `<script>` in `index.html`
(or better, regenerate — see below). You need:

1. The form's POST URL: open the Google Form → **Send** → link, or view-source the live form and
   find `action="https://docs.google.com/forms/d/e/XXXXX/formResponse"`.
2. Each field's entry ID: in the live form, right-click a field → Inspect → find
   `name="entry.123456789"`. Map them:

```js
window.MICRONS_CONFIG = {
  googleFormAction: "https://docs.google.com/forms/d/e/XXXXX/formResponse",
  entries: {
    name:"entry.___", medspa:"entry.___", location:"entry.___",
    email:"entry.___", phone:"entry.___", monthly_leads:"entry.___",
    crm:"entry.___", gap:"entry.___"
  }
};
```

Until it's filled, the form still works — it shows the confirmation + Calendly and keeps a
`localStorage` copy, it just doesn't post to Google yet.

## Rebuilding `index.html`

`index.html` is assembled by `scripts/build_site.py` from `.reference/microns-lovable-ssr.html`
(a saved copy of the Lovable SSR output). Re-run it after editing the build script:

```bash
py -3 scripts/build_site.py
```

For small copy tweaks it's fine to edit `index.html` directly.

## If you later connect Lovable → GitHub

This is a static snapshot, not synced with Lovable. If you get the Lovable repo connected,
the same 6 changes should be ported into the React source there and this service retired.
