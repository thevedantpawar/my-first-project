"use server";

import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn } from "@/auth";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import type { ActionResult } from "./cart";

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().max(200).optional(),
});

/**
 * Credentials sign-in.
 *
 * The failure message is deliberately identical whether the account does not
 * exist or the password is wrong — pairing a specific message with the
 * constant-time hash comparison in `auth.ts` is what actually prevents account
 * enumeration.
 */
export async function signInWithCredentials(
  input: unknown,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check your details.",
    };
  }

  const { email, password, next } = parsed.data;

  // Keyed by IP *and* the email being tried, so one attacker cannot lock out a
  // specific account by burning that account's allowance from many addresses,
  // and cannot spray many accounts from one address either.
  try {
    await enforceRateLimit("signIn", email.toLowerCase());
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false, error: error.message };
    throw error;
  }

  // Only same-origin paths, so `?next=` cannot become an open redirect.
  const redirectTo =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  try {
    await signIn("credentials", { email, password, redirect: false });
    return { ok: true, data: { redirectTo } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, error: "Email or password is incorrect." };
    }
    throw error;
  }
}
