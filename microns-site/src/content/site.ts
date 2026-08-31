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
  domain: "micronsai.com",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://micronsai.com",
  tagline:
    "Automation systems that catch the calls, leads and no-shows med spas lose.",

  founder: {
    firstName: "Vedant",
    lastName: "Pawar",
    city: "", // TODO add city. Left empty, the sentence omits it.
    email: "ved@micronsai.com",
  },

  /**
   * Booking. If this is unset the /book page shows the direct-email fallback
   * instead of an empty iframe.
   */
  bookingUrl: process.env.NEXT_PUBLIC_BOOKING_URL ?? "", // TODO cal.com / Calendly link

  /**
   * Pricing. Do not hide this — med spa owners abandon sites that will not say.
   */
  pricing: {
    rangeLow: "$1,500",
    rangeHigh: "$3,000",
    monthly: "$750",
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
