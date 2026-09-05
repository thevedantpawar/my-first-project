import "server-only";

/**
 * Phone OTP, stubbed behind an interface.
 *
 * Indian pharmacy customers overwhelmingly authenticate by phone, so the seam
 * is defined now even though delivery is not wired. Swapping in MSG91, Twilio
 * or AWS SNS means implementing this interface and changing one line in
 * `getOtpProvider` — no call site changes.
 */

export type OtpSendResult = {
  /** Opaque handle the verify step quotes back. */
  requestId: string;
  expiresAt: Date;
};

export interface OtpProvider {
  readonly name: string;
  send(phone: string): Promise<OtpSendResult>;
  verify(requestId: string, code: string): Promise<boolean>;
}

const OTP_TTL_MS = 5 * 60 * 1000;

/**
 * Development stub. Logs the code to the server console instead of sending it,
 * and holds state in memory — so it is deliberately useless in production,
 * where a multi-process deploy would lose the map between send and verify.
 */
class StubOtpProvider implements OtpProvider {
  readonly name = "stub";
  private readonly pending = new Map<string, { code: string; expiresAt: Date }>();

  async send(phone: string): Promise<OtpSendResult> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const requestId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    this.pending.set(requestId, { code, expiresAt });

    console.info(
      `[otp:stub] OTP for ${phone} is ${code} (request ${requestId}, expires ${expiresAt.toISOString()})`,
    );

    return { requestId, expiresAt };
  }

  async verify(requestId: string, code: string): Promise<boolean> {
    const entry = this.pending.get(requestId);
    if (!entry) return false;

    if (entry.expiresAt < new Date()) {
      this.pending.delete(requestId);
      return false;
    }

    const ok = entry.code === code;
    if (ok) this.pending.delete(requestId);
    return ok;
  }
}

let provider: OtpProvider | null = null;

export function getOtpProvider(): OtpProvider {
  if (provider) return provider;

  const configured = process.env.OTP_PROVIDER ?? "stub";

  switch (configured) {
    case "stub":
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "OTP_PROVIDER is 'stub' in production. The stub holds codes in " +
            "process memory and logs them to the console — it is not an " +
            "authentication mechanism. Configure a real SMS provider.",
        );
      }
      provider = new StubOtpProvider();
      return provider;

    default:
      throw new Error(
        `Unknown OTP_PROVIDER "${configured}". Implement OtpProvider and ` +
          `register it in getOtpProvider().`,
      );
  }
}
