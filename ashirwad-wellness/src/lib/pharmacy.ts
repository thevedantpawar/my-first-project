import "server-only";

/**
 * Statutory identity of the dispensing premises.
 *
 * These values are read from the environment, never hardcoded, and never
 * invented. The placeholders in .env.example are deliberately malformed so a
 * half-configured deploy is obvious rather than plausible — a fabricated drug
 * licence number rendered as genuine on a live storefront is a regulatory
 * problem, not a cosmetic one.
 */

const PLACEHOLDER_PREFIX = "REPLACE_ME";

function read(key: string): string {
  return process.env[key] ?? `${PLACEHOLDER_PREFIX}_${key}`;
}

export const pharmacy = {
  legalName: read("PHARMACY_LEGAL_NAME"),
  tradeName: process.env.PHARMACY_TRADE_NAME ?? "Ashirwad Medical",
  address: read("PHARMACY_ADDRESS"),

  /** Form 20B — retail sale of drugs other than Schedule C / C(1). */
  drugLicence20B: read("PHARMACY_DL_NO_20B"),
  /** Form 21B — retail sale of Schedule C / C(1) drugs. */
  drugLicence21B: read("PHARMACY_DL_NO_21B"),
  licenceIssuingAuthority: read("PHARMACY_DL_ISSUING_AUTHORITY"),

  /** Required because the catalogue carries nutraceuticals, not because of drugs. */
  fssaiLicence: read("PHARMACY_FSSAI_NO"),
  gstin: read("PHARMACY_GSTIN"),

  /** Registered pharmacist under the Pharmacy Act 1948. */
  pharmacistName: read("PHARMACIST_NAME"),
  pharmacistRegNo: read("PHARMACIST_REG_NO"),
  pharmacistCouncil:
    process.env.PHARMACIST_COUNCIL ?? "Maharashtra State Pharmacy Council",

  supportEmail: read("PHARMACY_SUPPORT_EMAIL"),
  supportPhone: read("PHARMACY_SUPPORT_PHONE"),
} as const;

/** Which statutory fields are still unconfigured. */
export function unconfiguredRegulatoryFields(): string[] {
  return Object.entries(pharmacy)
    .filter(([, value]) => typeof value === "string" && value.startsWith(PLACEHOLDER_PREFIX))
    .map(([key]) => key);
}

export function isRegulatoryIdentityComplete(): boolean {
  return unconfiguredRegulatoryFields().length === 0;
}

/**
 * Fails a production build or boot when statutory identifiers are missing.
 * A pharmacy that cannot state its drug licence number must not be taking
 * orders, so this throws rather than warns.
 */
export function assertRegulatoryIdentityConfigured(): void {
  const missing = unconfiguredRegulatoryFields();
  if (missing.length === 0) return;

  const message =
    `Refusing to serve: ${missing.length} statutory identifier(s) are still ` +
    `placeholders — ${missing.join(", ")}. Set them in the environment. ` +
    `See .env.example.`;

  if (process.env.NODE_ENV === "production") {
    throw new Error(message);
  }
  console.warn(`[compliance] ${message}`);
}

/** Config knobs that are policy decisions rather than statutory facts. */
export const policy = {
  /**
   * Default validity a pharmacist's verification carries, in days. Editable
   * per-prescription in the verification form; this is only the form default.
   * 30 days matches common practice for acute prescriptions — chronic repeat
   * medication is routinely set longer by the verifying pharmacist.
   */
  defaultPrescriptionValidityDays: 30,

  /** Cash-on-delivery ceiling. Orders above this must prepay. */
  codCeilingPaise: Number(process.env.COD_CEILING_PAISE ?? 500_000),

  /** Lifetime of a signed prescription-image URL. Short by design. */
  signedUrlTtlSeconds: Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300),
} as const;
