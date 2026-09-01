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

## The 6 changes

1. **Audit form** — real form in `#audit` (name, med spa, location, email, phone, monthly leads, gap).
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
   `hello@microns.ai` is still a placeholder — swap for a real address + phone.

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
    email:"entry.___", phone:"entry.___", monthly_leads:"entry.___", gap:"entry.___"
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
