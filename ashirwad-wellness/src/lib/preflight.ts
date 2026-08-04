/**
 * Production readiness checks.
 *
 * This is the gate `.env.example` promises: one place that answers "is this
 * deployment allowed to accept a real customer's order?" — and answers it
 * before the deployment is reachable, rather than at the moment a customer
 * tries to do something.
 *
 * Deliberately a pure function returning findings. It does not read
 * NODE_ENV, print, or exit, so it can be unit-tested and so the CLI, a health
 * endpoint and a future CI step can all share one definition of "ready".
 *
 * Blockers are things that make the deployment unlawful or unsafe to operate:
 * missing statutory identifiers, prescription images landing on local disk, a
 * disabled rate limiter. Warnings are things that degrade the service without
 * making it non-compliant — no email provider, no online payments.
 */

export type Finding = {
  level: "blocker" | "warning";
  key: string;
  message: string;
};

const PLACEHOLDER = /REPLACE_ME/i;

/** The statutory identifiers that must be real before anything is dispensed. */
const REGULATORY_VARS = [
  "PHARMACY_LEGAL_NAME",
  "PHARMACY_ADDRESS",
  "PHARMACY_DL_NO_20B",
  "PHARMACY_DL_NO_21B",
  "PHARMACY_DL_ISSUING_AUTHORITY",
  "PHARMACY_FSSAI_NO",
  "PHARMACIST_NAME",
  "PHARMACIST_REG_NO",
  "PHARMACY_GSTIN",
  "PHARMACY_SUPPORT_EMAIL",
  "PHARMACY_SUPPORT_PHONE",
] as const;

export function checkProductionReadiness(
  env: Record<string, string | undefined>,
): Finding[] {
  const findings: Finding[] = [];
  const blocker = (key: string, message: string) =>
    findings.push({ level: "blocker", key, message });
  const warning = (key: string, message: string) =>
    findings.push({ level: "warning", key, message });

  const isSet = (k: string) => {
    const v = env[k];
    return typeof v === "string" && v.trim() !== "";
  };

  // --- Core -----------------------------------------------------------------
  if (!isSet("DATABASE_URL")) {
    blocker("DATABASE_URL", "No database configured.");
  }

  if (!isSet("AUTH_SECRET")) {
    blocker("AUTH_SECRET", "Unset. Sessions and signed prescription URLs both depend on it.");
  } else {
    const secret = env.AUTH_SECRET!;
    if (PLACEHOLDER.test(secret) || secret.startsWith("generate-with")) {
      blocker("AUTH_SECRET", "Still the placeholder from .env.example. Run: openssl rand -base64 32");
    } else if (secret.length < 32) {
      blocker(
        "AUTH_SECRET",
        `Only ${secret.length} characters. This key signs prescription URLs; use at least 32.`,
      );
    }
  }

  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    blocker(
      "NEXT_PUBLIC_SITE_URL",
      "Unset. Canonicals, the sitemap and JSON-LD would all point at localhost.",
    );
  } else if (!/^https:\/\//.test(siteUrl)) {
    blocker(
      "NEXT_PUBLIC_SITE_URL",
      `Not https (${siteUrl}). Prescriptions and credentials must not cross the network in clear.`,
    );
  }

  // --- Statutory identity ---------------------------------------------------
  for (const key of REGULATORY_VARS) {
    const value = env[key];
    if (!value || value.trim() === "") {
      blocker(key, "Statutory identifier not set.");
    } else if (PLACEHOLDER.test(value)) {
      blocker(key, `Still a placeholder (${value}).`);
    }
  }

  // --- Private storage ------------------------------------------------------
  // The single most consequential check here. Without it, prescription images
  // — sensitive personal data — are written to the application filesystem,
  // where they survive no redeploy and are backed up by nobody.
  if (!isSet("S3_BUCKET_PRESCRIPTIONS")) {
    blocker(
      "S3_BUCKET_PRESCRIPTIONS",
      "No private object storage. Prescription images must not go to local disk.",
    );
  } else {
    for (const key of ["S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      if (!isSet(key)) {
        blocker(key, "Private storage is only half configured.");
      }
    }
  }

  // --- Safety rails that must not be switched off in production -------------
  if (env.RATE_LIMIT_DISABLED === "true") {
    blocker(
      "RATE_LIMIT_DISABLED",
      "Set to true. This is an E2E-only bypass and must never be set in production.",
    );
  }

  const ttl = Number(env.SIGNED_URL_TTL_SECONDS ?? 300);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    blocker("SIGNED_URL_TTL_SECONDS", "Not a positive number.");
  } else if (ttl > 3600) {
    blocker(
      "SIGNED_URL_TTL_SECONDS",
      `${ttl}s is too long for a link to a prescription image. Keep it in minutes.`,
    );
  }

  // --- Degraded but lawful --------------------------------------------------
  if (!isSet("RESEND_API_KEY")) {
    warning(
      "RESEND_API_KEY",
      "No email provider. Order confirmations and pharmacist decisions will only be logged.",
    );
  }

  if (!isSet("RAZORPAY_KEY_ID") || !isSet("RAZORPAY_KEY_SECRET")) {
    warning(
      "RAZORPAY_KEY_ID",
      "Payments not configured. The site will be able to take cash on delivery only.",
    );
  } else if (env.RAZORPAY_KEY_ID!.startsWith("rzp_test_")) {
    warning(
      "RAZORPAY_KEY_ID",
      "Razorpay is in TEST mode. Real customers cannot pay and no money will move.",
    );
  }

  if (env.OTP_PROVIDER === "stub" || !isSet("OTP_PROVIDER")) {
    warning(
      "OTP_PROVIDER",
      "Phone OTP is the development stub. Harmless while phone sign-in is unused.",
    );
  }

  return findings;
}

export function isReady(findings: Finding[]): boolean {
  return !findings.some((f) => f.level === "blocker");
}
