import { describe, it, expect } from "vitest";

import { checkProductionReadiness, isReady } from "@/lib/preflight";

/**
 * The readiness gate.
 *
 * These matter more than most tests here: this is the check that decides
 * whether a deployment may accept a real order. A false "ready" is the one
 * failure mode that could put a non-compliant pharmacy online.
 */

/** A fully configured environment. Values are shaped like real ones but are not real. */
function readyEnv(): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgresql://u:p@db:5432/ashirwad",
    AUTH_SECRET: "K7d0zqfQmA2X9vLpR4sTnB6yUeWc1hJgOi3ExVkZaYs=",
    NEXT_PUBLIC_SITE_URL: "https://ashirwadwellness.in",
    PHARMACY_LEGAL_NAME: "Example Medical Stores",
    PHARMACY_ADDRESS: "1 Example Road, Nashik, Maharashtra",
    PHARMACY_DL_NO_20B: "20B-EXAMPLE-0001",
    PHARMACY_DL_NO_21B: "21B-EXAMPLE-0001",
    PHARMACY_DL_ISSUING_AUTHORITY: "Maharashtra FDA, Nashik Zone",
    PHARMACY_FSSAI_NO: "10000000000000",
    PHARMACIST_NAME: "Example Pharmacist",
    PHARMACIST_REG_NO: "MSPC-EXAMPLE-1",
    PHARMACY_GSTIN: "27AAAAA0000A1Z5",
    PHARMACY_SUPPORT_EMAIL: "support@example.invalid",
    PHARMACY_SUPPORT_PHONE: "+91 00000 00000",
    S3_BUCKET_PRESCRIPTIONS: "ashirwad-prescriptions",
    S3_REGION: "ap-south-1",
    S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
    S3_SECRET_ACCESS_KEY: "secretexamplevalue",
    RESEND_API_KEY: "re_example",
    RAZORPAY_KEY_ID: "rzp_live_example",
    RAZORPAY_KEY_SECRET: "secret",
    OTP_PROVIDER: "msg91",
  };
}

const blockerKeys = (env: Record<string, string | undefined>) =>
  checkProductionReadiness(env)
    .filter((f) => f.level === "blocker")
    .map((f) => f.key);

describe("production readiness", () => {
  it("passes a fully configured environment", () => {
    const findings = checkProductionReadiness(readyEnv());
    expect(findings.filter((f) => f.level === "blocker")).toEqual([]);
    expect(isReady(findings)).toBe(true);
  });

  it("blocks every statutory identifier left as a placeholder", () => {
    const env = readyEnv();
    env.PHARMACY_DL_NO_20B = "REPLACE_ME_FORM_20B_LICENCE_NO";
    env.PHARMACIST_REG_NO = "REPLACE_ME_MSPC_REGISTRATION_NO";

    const keys = blockerKeys(env);
    expect(keys).toContain("PHARMACY_DL_NO_20B");
    expect(keys).toContain("PHARMACIST_REG_NO");
  });

  it("blocks an unset statutory identifier as well as a placeholder one", () => {
    const env = readyEnv();
    delete env.PHARMACY_FSSAI_NO;
    env.PHARMACY_GSTIN = "   ";
    const keys = blockerKeys(env);
    expect(keys).toContain("PHARMACY_FSSAI_NO");
    expect(keys).toContain("PHARMACY_GSTIN");
  });

  it("blocks prescriptions landing on local disk", () => {
    const env = readyEnv();
    delete env.S3_BUCKET_PRESCRIPTIONS;
    expect(blockerKeys(env)).toContain("S3_BUCKET_PRESCRIPTIONS");
  });

  it("blocks half-configured storage, which would fail at first upload", () => {
    const env = readyEnv();
    delete env.S3_SECRET_ACCESS_KEY;
    expect(blockerKeys(env)).toContain("S3_SECRET_ACCESS_KEY");
  });

  it("blocks a rate-limit bypass reaching production", () => {
    const env = readyEnv();
    env.RATE_LIMIT_DISABLED = "true";
    expect(blockerKeys(env)).toContain("RATE_LIMIT_DISABLED");
  });

  it("blocks a weak or placeholder AUTH_SECRET", () => {
    expect(blockerKeys({ ...readyEnv(), AUTH_SECRET: "short" })).toContain("AUTH_SECRET");
    expect(
      blockerKeys({ ...readyEnv(), AUTH_SECRET: "generate-with: openssl rand -base64 32" }),
    ).toContain("AUTH_SECRET");
  });

  it("blocks a non-https site URL", () => {
    const env = readyEnv();
    env.NEXT_PUBLIC_SITE_URL = "http://ashirwadwellness.in";
    expect(blockerKeys(env)).toContain("NEXT_PUBLIC_SITE_URL");
  });

  it("blocks a prescription link that lives too long", () => {
    const env = readyEnv();
    env.SIGNED_URL_TTL_SECONDS = "86400";
    expect(blockerKeys(env)).toContain("SIGNED_URL_TTL_SECONDS");
  });

  it("treats a missing email provider as degraded, not unlawful", () => {
    const env = readyEnv();
    delete env.RESEND_API_KEY;
    const findings = checkProductionReadiness(env);
    expect(isReady(findings)).toBe(true);
    expect(findings.find((f) => f.key === "RESEND_API_KEY")?.level).toBe("warning");
  });

  it("warns rather than blocks when Razorpay is still in test mode", () => {
    const env = readyEnv();
    env.RAZORPAY_KEY_ID = "rzp_test_abc";
    const findings = checkProductionReadiness(env);
    expect(isReady(findings)).toBe(true);
    expect(findings.find((f) => f.key === "RAZORPAY_KEY_ID")?.message).toMatch(/TEST mode/);
  });

  it("does not block on the OTP stub, which no live flow uses", () => {
    const env = readyEnv();
    env.OTP_PROVIDER = "stub";
    expect(isReady(checkProductionReadiness(env))).toBe(true);
  });
});
