import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/login-form";
import type { RawSearchParams } from "@/lib/search-params";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await auth();
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  if (session?.user?.id) {
    redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-500">
        Prescription medicines are dispensed to a verified account only, so
        signing in is required before checkout.
      </p>

      <div className="mt-6 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-5">
        <LoginForm next={next} />
      </div>

      {process.env.NODE_ENV !== "production" && (
        <div className="mt-4 rounded-[var(--radius-control)] border border-turmeric-500/40 bg-turmeric-50 p-3 text-xs text-ink-700">
          <p className="font-semibold">Development seed accounts</p>
          <ul className="mt-1 space-y-0.5">
            <li>
              <span className="identifier">customer@example.invalid</span> —
              customer
            </li>
            <li>
              <span className="identifier">pharmacist@ashirwadwellness.in</span> —
              pharmacist
            </li>
            <li>
              <span className="identifier">admin@ashirwadwellness.in</span> — admin
            </li>
          </ul>
          <p className="mt-1">
            Password <span className="identifier">Ashirwad@2026</span>
          </p>
        </div>
      )}
    </div>
  );
}
