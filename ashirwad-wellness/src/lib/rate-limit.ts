import "server-only";
import { headers } from "next/headers";

/**
 * Rate limiting.
 *
 * Behind an interface, with an in-process fixed-window counter as the default
 * implementation. That default is honest about its limits: it does not survive
 * a restart and does not coordinate across instances, so a multi-instance
 * deployment needs the Redis implementation registered in `getRateLimiter`.
 *
 * The limits below are deliberately tight on the three surfaces that matter:
 *
 *  - **Sign-in** — credential stuffing is the obvious attack on an account that
 *    holds prescriptions.
 *  - **Upload** — prescription images are large, and unbounded writes to
 *    object storage cost money as well as disk.
 *  - **Checkout** — order placement runs a transaction that decrements stock
 *    and reads the Rx gate; hammering it is the cheapest way to cause damage.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
};

export interface RateLimiter {
  readonly name: string;
  check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

class InMemoryRateLimiter implements RateLimiter {
  readonly name = "in-memory";
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowSeconds * 1000;
      this.windows.set(key, { count: 1, resetAt });
      this.sweep(now);
      return { allowed: true, remaining: limit - 1, retryAfter: 0 };
    }

    existing.count += 1;
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);

    if (existing.count > limit) {
      return { allowed: false, remaining: 0, retryAfter };
    }

    return { allowed: true, remaining: limit - existing.count, retryAfter };
  }

  /** Drops expired windows so the map does not grow without bound. */
  private sweep(now: number) {
    if (this.windows.size < 5000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

let limiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;

  if (process.env.RATE_LIMIT_REDIS_URL) {
    throw new Error(
      "RATE_LIMIT_REDIS_URL is set but the Redis limiter is not implemented. " +
        "Implement RateLimiter against Redis and register it in getRateLimiter().",
    );
  }

  if (process.env.NODE_ENV === "production" && process.env.INSTANCE_COUNT !== "1") {
    console.warn(
      "[rate-limit] Using the in-process limiter in production. It does not " +
        "coordinate across instances — set RATE_LIMIT_REDIS_URL for a real deployment.",
    );
  }

  limiter = new InMemoryRateLimiter();
  return limiter;
}

/** Named limits, so they are visible in one place rather than scattered. */
export const LIMITS = {
  signIn: { limit: 8, windowSeconds: 15 * 60 },
  prescriptionUpload: { limit: 12, windowSeconds: 60 * 60 },
  healthRecordUpload: { limit: 20, windowSeconds: 60 * 60 },
  checkout: { limit: 10, windowSeconds: 10 * 60 },
  search: { limit: 120, windowSeconds: 60 },
} as const;

/** Client IP behind the proxy chain. Falls back to a constant, which makes the
 *  limit global rather than per-client — degrading closed, not open. */
export async function clientKey(prefix: string): Promise<string> {
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      "unknown";
    return `${prefix}:${ip}`;
  } catch {
    return `${prefix}:no-request-scope`;
  }
}

/**
 * Test-only bypass.
 *
 * The end-to-end suite signs in repeatedly across specs and would otherwise
 * trip the sign-in limit — which is the limit doing its job, but it makes the
 * suite unrunnable and tempts people to weaken the real limit instead.
 *
 * This throws rather than warns if it is ever set in production. A rate limiter
 * that can be switched off by an environment variable on a live pharmacy is not
 * a rate limiter.
 */
function isRateLimitDisabled(): boolean {
  if (process.env.RATE_LIMIT_DISABLED !== "true") return false;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RATE_LIMIT_DISABLED is set in production. It exists only so the " +
        "end-to-end suite can sign in repeatedly. Unset it.",
    );
  }

  return true;
}

export class RateLimitError extends Error {
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    const minutes = Math.ceil(retryAfter / 60);
    super(
      `Too many attempts. Please wait ${
        minutes <= 1 ? "a minute" : `${minutes} minutes`
      } and try again.`,
    );
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Applies a named limit, keyed by IP and optionally narrowed further (by user
 * id, or by the email being attempted). Throws RateLimitError when exceeded.
 */
export async function enforceRateLimit(
  name: keyof typeof LIMITS,
  discriminator?: string,
): Promise<void> {
  if (isRateLimitDisabled()) return;

  const { limit, windowSeconds } = LIMITS[name];
  const base = await clientKey(name);
  const key = discriminator ? `${base}:${discriminator}` : base;

  const result = await getRateLimiter().check(key, limit, windowSeconds);
  if (!result.allowed) {
    throw new RateLimitError(result.retryAfter);
  }
}
