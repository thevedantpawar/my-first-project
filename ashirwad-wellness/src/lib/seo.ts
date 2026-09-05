import { pharmacy } from "./pharmacy";

/**
 * Canonical origin.
 *
 * Falls back to localhost in development. In production an unset value would
 * put `http://localhost:3000` into the sitemap and every canonical tag, so it
 * throws instead — a silently wrong canonical is worse than a failed boot.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is not set. It is used for canonical URLs, the " +
        "sitemap and JSON-LD, all of which would otherwise point at localhost.",
    );
  }

  return "http://localhost:3000";
}

/**
 * Organisation JSON-LD for the storefront.
 *
 * Typed as `Pharmacy`, which is what this is, and carries the drug licence and
 * the registered pharmacist. Unconfigured identifiers are omitted rather than
 * emitted as `REPLACE_ME_…` — structured data asserting a fake licence number
 * is worse than structured data that is merely incomplete.
 */
export function pharmacyJsonLd() {
  const set = (value: string) => (value.startsWith("REPLACE_ME") ? undefined : value);

  return {
    "@context": "https://schema.org",
    "@type": "Pharmacy",
    name: pharmacy.tradeName,
    legalName: set(pharmacy.legalName),
    url: siteUrl(),
    address: {
      "@type": "PostalAddress",
      streetAddress: set(pharmacy.address),
      addressLocality: "Nashik",
      addressRegion: "Maharashtra",
      addressCountry: "IN",
    },
    email: set(pharmacy.supportEmail),
    telephone: set(pharmacy.supportPhone),
    taxID: set(pharmacy.gstin),
    // The licences a customer or regulator would want to check.
    identifier: [
      set(pharmacy.drugLicence20B) && {
        "@type": "PropertyValue",
        name: "Drug Licence (Form 20B)",
        value: pharmacy.drugLicence20B,
      },
      set(pharmacy.drugLicence21B) && {
        "@type": "PropertyValue",
        name: "Drug Licence (Form 21B)",
        value: pharmacy.drugLicence21B,
      },
      set(pharmacy.fssaiLicence) && {
        "@type": "PropertyValue",
        name: "FSSAI Licence",
        value: pharmacy.fssaiLicence,
      },
    ].filter(Boolean),
    employee: set(pharmacy.pharmacistName)
      ? {
          "@type": "Person",
          name: pharmacy.pharmacistName,
          jobTitle: "Registered Pharmacist",
          identifier: set(pharmacy.pharmacistRegNo),
        }
      : undefined,
    areaServed: {
      "@type": "AdministrativeArea",
      name: "Nashik district, Maharashtra",
    },
  };
}

/** Breadcrumb JSON-LD, so category pages read correctly in search results. */
export function breadcrumbJsonLd(
  trail: { name: string; path: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: `${siteUrl()}${step.path}`,
    })),
  };
}
