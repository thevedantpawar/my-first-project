# Microns — marketing site

Single-page static site. One `index.html`, no build step, no framework.
All CSS is already compiled and inlined; the only external request is one Google font.

## Deploy (Cloudflare Pages)

```
npx wrangler pages deploy microns-site --project-name=microns
```

Or, with zero CLI: Cloudflare dashboard → Workers & Pages → Create → Pages →
**Upload assets** → drag the `microns-site` folder in. Same folder works as-is on
Netlify (drag to app.netlify.com/drop) and Vercel.

## Placeholders to replace before going live

| # | What | Where |
|---|------|-------|
| 1 | **Cal.com booking link** | `CONFIG.calUrl` in the `<script>` at the bottom of `index.html`. One value, used by all 4 CTAs. |
| 2 | **Demo video** | `CONFIG.videoEmbedUrl`, same block. Use the *embed* URL (`https://www.loom.com/embed/ID` or `https://www.youtube.com/embed/ID`). Empty = placeholder state. The iframe only loads on click. |
| 3 | **Founder photo** | Search `PLACEHOLDER: replace this div` in the Founder section. Drop `vedant.jpg` in this folder and swap in the commented-out `<img>` tag. |
| 4 | **Email address** | Footer, `mailto:hello@micronsai.com`. |
| 5 | **LinkedIn URL** | Footer, `linkedin.com/in/PLACEHOLDER`. |
| 6 | **OG share image** | Add a 1200×630 `og-image.jpg` to this folder (already referenced in the meta tags). |
| 7 | **Favicon** | `favicon.svg` is a plain placeholder mark — replace with your own. |

## Editing

Text edits: open `index.html` and type. Nothing to rebuild.

Adding *new* Tailwind classes: the compiled CSS is inlined between the
`/* tw:start */` and `/* tw:end */` markers in `index.html`. To regenerate:

```
npx @tailwindcss/cli@4 -i tailwind-source.css -o tailwind.css --minify
```

then paste `tailwind.css` between those two markers. `tailwind-source.css` also
holds the colour palette and the few hand-written rules (hero wash, scroll
reveal, FAQ accordion). It is not loaded by the page and does not affect deploys.
