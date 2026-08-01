import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { AddressActions } from "@/components/account-forms";

export const metadata: Metadata = { title: "Addresses", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const addresses = await db.address.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div className="max-w-2xl">
      <p className="text-xs text-ink-500">
        New addresses are added during checkout, where serviceability is checked
        before the rest of the address is asked for.
      </p>

      {addresses.length === 0 ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-ink-100 p-10 text-center text-sm text-ink-500">
          No saved addresses yet.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {addresses.map((a) => (
            <li key={a.id} className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {a.fullName}
                    {a.isDefault && (
                      <span className="ml-2 rounded-full bg-pine-100 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-pine-700">
                        Default
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-500">
                    {[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-xs text-ink-500">
                    {a.city}, {a.state} <span className="identifier">{a.pincode}</span>
                  </p>
                  <p className="identifier text-[0.625rem] text-ink-300">{a.phone}</p>
                </div>
                <AddressActions addressId={a.id} isDefault={a.isDefault} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
