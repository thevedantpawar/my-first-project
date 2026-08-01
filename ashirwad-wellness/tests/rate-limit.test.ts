import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getRateLimiter, enforceRateLimit, RateLimitError, LIMITS } from "@/lib/rate-limit";

const original = process.env.RATE_LIMIT_DISABLED;

beforeEach(() => {
  delete process.env.RATE_LIMIT_DISABLED;
});

afterEach(() => {
  if (original === undefined) delete process.env.RATE_LIMIT_DISABLED;
  else process.env.RATE_LIMIT_DISABLED = original;
});

describe("rate limiter", () => {
  it("allows up to the limit and refuses beyond it", async () => {
    const limiter = getRateLimiter();
    const key = `unit-${Math.random()}`;

    for (let i = 1; i <= 3; i++) {
      const result = await limiter.check(key, 3, 60);
      expect(result.allowed, `attempt ${i} of 3`).toBe(true);
    }

    const blocked = await limiter.check(key, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts each key independently", async () => {
    const limiter = getRateLimiter();
    const a = `unit-a-${Math.random()}`;
    const b = `unit-b-${Math.random()}`;

    await limiter.check(a, 1, 60);
    expect((await limiter.check(a, 1, 60)).allowed).toBe(false);
    // A different key must be unaffected — one account being attacked cannot
    // lock everyone else out.
    expect((await limiter.check(b, 1, 60)).allowed).toBe(true);
  });

  it("resets after the window", async () => {
    const limiter = getRateLimiter();
    const key = `unit-window-${Math.random()}`;

    await limiter.check(key, 1, 1);
    expect((await limiter.check(key, 1, 1)).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 1100));
    expect((await limiter.check(key, 1, 1)).allowed).toBe(true);
  });

  it("throws RateLimitError from enforceRateLimit once exceeded", async () => {
    const discriminator = `unit-enforce-${Math.random()}`;
    const { limit } = LIMITS.signIn;

    for (let i = 0; i < limit; i++) {
      await enforceRateLimit("signIn", discriminator);
    }

    await expect(enforceRateLimit("signIn", discriminator)).rejects.toThrow(RateLimitError);
  });

  it("honours the test-only bypass outside production", async () => {
    process.env.RATE_LIMIT_DISABLED = "true";
    const discriminator = `unit-bypass-${Math.random()}`;

    for (let i = 0; i < LIMITS.signIn.limit + 5; i++) {
      await expect(enforceRateLimit("signIn", discriminator)).resolves.toBeUndefined();
    }
  });

  it("refuses the bypass in production", async () => {
    // `process.env` rejects defineProperty, so assign through a widened view
    // rather than fighting the read-only NODE_ENV type.
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;

    env.RATE_LIMIT_DISABLED = "true";
    env.NODE_ENV = "production";

    try {
      await expect(enforceRateLimit("signIn", "prod-check")).rejects.toThrow(
        /RATE_LIMIT_DISABLED is set in production/,
      );
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
