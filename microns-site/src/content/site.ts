/**
 * Single source of truth for everything that is a business decision rather than
 * a design one. Change values here, not in the pages.
 *
 * CONFIRM BEFORE LAUNCH — the values marked TODO are placeholders chosen so the
 * page renders honestly. Replace them with numbers and links you can defend on
 * a call.
 */

export const site = {
  name: "Microns",
  domain: "microns.studio", // TODO confirm the real domain
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://microns.studio",
  tagline:
    "Automation systems that catch the calls, leads and no-shows med spas lose.",

  founder: {
    firstName: "Vedant",
    lastName: "Pawar", // TODO confirm spelling
    city: "", // TODO add city. Left empty, the sentence omits it.
    email: "hello@microns.studio", // TODO confirm
  },

  /**
   * Booking. If this is unset the /book page shows the direct-email fallback
   * instead of an empty iframe.
   */
  bookingUrl: process.env.NEXT_PUBLIC_BOOKING_URL ?? "", // TODO cal.com / Calendly link

  /**
   * Pricing. Section 5.5 of the brief: do not hide this. This is the honest
   * range wording, not invented precision.
   * TODO replace with your real numbers before launch.
   */
  pricing: {
    rangeLow: "$2,000",
    rangeHigh: "$6,000",
    monthly: "$350",
    commitment: "Month to month. No annual contract.",
  },

  /** Plausible domain. Analytics only load when this is set. */
  plausibleDomain: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "",
} as const;

export const routes = [
  { href: "/systems", label: "Systems" },
  { href: "/about", label: "About" },
] as const;

export const CTA_PRIMARY = "Book a 20-minute call";
export const CTA_SECONDARY = "Request a revenue leak audit";
