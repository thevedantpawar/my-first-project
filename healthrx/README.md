# HealthRx Fitness Club — *We Prescribe Health*

A premium, award-style marketing site for **HealthRx Fitness Club**, a
science-driven medical fitness club in Nashik. Built to feel like
Apple × Nike × Technogym: black canvas, white type, neon-lime accent.

## Stack

- **Next.js 14** (App Router) · **React 18** · **TypeScript**
- **Tailwind CSS** for the design system
- **Framer Motion** for reveal-on-scroll, parallax and the cinematic loader
- Zero runtime data deps — fully static, exported at build time

## Design system

| Token | Value |
| ----- | ----- |
| Ink (background) | `#0B0B0B` |
| White (type) | `#FFFFFF` |
| Lime (accent) | `#FFF200` |

Fonts: **Space Grotesk** (display) + **Inter** (body), self-hosted via
`next/font`.

## Sections

Hero · Services grid · Medical fitness philosophy · Trainer cards ·
Membership plans · Before/after transformation slider · Testimonials
marquee · BMI / Calorie / Macro calculators · Nutrition coaching · FAQ ·
Blog · Contact (WhatsApp CTA + Google Maps + inquiry form).

## Signature interactions

- Cinematic heartbeat-line loading animation
- Floating-particle canvas hero with a CSS-3D dumbbell + pulse rings
- Parallax scroll, reveal-on-scroll, hover-tilt trainer cards
- Animated number counters and macro donut
- Draggable before/after comparison slider
- **Live** BMI, TDEE (Mifflin-St Jeor) and macro-split calculators

## Calculator math

- **BMI** = weight(kg) / height(m)²
- **BMR** = Mifflin-St Jeor, then **TDEE** = BMR × activity factor
- **Macros** = 2 g protein/kg, 25% kcal from fat, carbs from the remainder

## SEO & performance

- Per-page metadata targeting *Best Gym in Nashik*, *Personal Training
  Nashik*, *Medical Fitness Nashik*, *Weight Loss Nashik*
- `HealthAndBeautyBusiness` JSON-LD, Open Graph, `robots.txt`, `sitemap.xml`,
  PWA manifest
- Lazy-loaded map, reduced-motion support throughout, WCAG-minded contrast
  and focus states, no horizontal overflow on mobile

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the production build
```

## Customising

All copy, pricing, trainers, contact details and the WhatsApp number live in
[`lib/site.ts`](./lib/site.ts) — edit one file to update the whole site.
Replace the placeholder phone/WhatsApp/address/maps values there before going
live.
