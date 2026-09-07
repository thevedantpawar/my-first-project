# MICRONS marketing site

Static reconstruction of the Lovable design (`aesthetic-nexus-systems.lovable.app`) — same
`styles-vcDe33lo.css`, fonts (Sora / Manrope), images and markup — served as plain HTML/CSS/JS
with a zero-dependency Node server.

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

1. **Booking panel** — `#book-panel` in the `#book` section holds an always-visible inline
   **Calendly** embed. It is the only conversion surface on the site: there is no lead form, no
   FormSubmit and no Google Form. The widget is lazy-initialised when the panel comes within
   400px of the viewport, so it costs nothing on first paint.
2. **Mobile** — hero card no longer `position:absolute` on small screens; sections reflow; slide-down
   mobile menu; sticky bottom "Book a discovery call" bar. Verify once more on a real device at 390 px.
3. **Legal + 404** — `privacy.html`, `terms.html` (template copy — review with counsel), branded `404.html`.
   Linked in the footer.
4. **SEO** — `Organization`/`ProfessionalService` JSON-LD added (FAQ JSON-LD kept), real `og:image`
   (`/assets/og-cover.jpg`), canonical, `sitemap.xml`, `robots.txt`.
5. **Results** — `#results` section between Why Microns and Pricing: the anonymized Skin Alive
   consultation-booking build, framed as "what we built" + a qualitative outcome (no invented numbers).
6. **Contact / Calendly** — `calendly.com/vedantpawar3690/30min` drives everything: the inline
   embed in `#book-panel`, the popup on any `[data-calendly]` link, and the footer link.
7. **Analytics** — GA4 scaffolded and instrumented, dormant until you paste a Measurement ID.
   See "Analytics" below.
8. **One CTA** — every call to action on the page reads **"Book a discovery call"** and points at
   `#book`. The "revenue leak audit" offer was removed entirely. `scripts/build_site.py` enforces
   this at build time: the `REBRAND` table asserts an exact occurrence count for each old string,
   and a final assert fails the build if any stray "audit" copy survives (the safety section's
   "audit log" is the one permitted use).
9. **Trust strip** (`#trust`) — slim band directly under the hero: founding-partner line plus four
   claims that are all independently true (US-only focus, clinical escalation, works around existing
   tooling, client approves messaging).
10. **Safety & compliance** (`#safety`) — sits between Proof of work and Pricing, and is linked from
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
| `booking_widget_view` | Calendly embed initialised (panel scrolled near) | — |
| `booking_scheduled` | **a call was actually booked** (Calendly postMessage) | — |
| `cta_click` | any "Book a discovery call" CTA, incl. the sticky mobile bar | `cta_text`, `cta_section` |
| `calendly_open` | scheduler popup opened | `surface` = `popup` |
| `demo_scenario` | demo tab switched | `scenario` |
| `faq_open` | an FAQ item opened | `question` |
| `scroll_depth` | 25 / 50 / 75 / 100% reached | `percent` |

**No PII is sent.** `booking_scheduled` records only that a booking happened — the name, email
and answers the visitor gave Calendly stay in Calendly and never reach analytics.

`booking_scheduled` is the number that matters: it is the site's only conversion.

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
