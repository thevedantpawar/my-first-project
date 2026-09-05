import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { History } from "lucide-react";

import { auth } from "@/auth";
import { getPharmacistActionLog } from "@/lib/pharmacist";
import type { AuditAction } from "@/generated/prisma/enums";

export const metadata: Metadata = {
  title: "My action log",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ACTION_LABEL: Partial<Record<AuditAction, string>> = {
  PRESCRIPTION_VERIFIED: "Verified a prescription",
  PRESCRIPTION_REJECTED: "Rejected a prescription",
  PRESCRIPTION_CLARIFICATION_REQUESTED: "Requested a clearer image",
  PRESCRIPTION_VIEWED: "Viewed a prescription image",
  H1_REGISTER_ENTRY_CREATED: "Wrote a Schedule H1 register entry",
  ORDER_STATUS_CHANGED: "Changed an order status",
};

/**
 * A pharmacist's own action history, read from the immutable audit log.
 *
 * Not a separate table: a pharmacist is personally accountable under the
 * Pharmacy Act for what is recorded against their registration number, so this
 * shows exactly what the audit log holds rather than a friendlier parallel
 * record that could drift from it.
 */
export default async function PharmacistLogPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const entries = await getPharmacistActionLog(session.user.id);

  return (
    <div>
      <div className="flex items-start gap-2">
        <History aria-hidden="true" className="mt-0.5 size-4 text-pine-700" />
        <div>
          <h2 className="text-base text-ink">My action log</h2>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-ink-500">
            Read directly from the immutable audit log. These entries are what is
            recorded against your registration number{" "}
            <span className="identifier">{session.user.pharmacistRegNo}</span>{" "}
            and cannot be edited or removed by anyone, including an
            administrator.
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-ink-100 p-12 text-center text-sm text-ink-500">
          No recorded actions yet.
        </div>
      ) : (
        <ol className="mt-4 space-y-2">
          {entries.map((entry) => {
            const meta = (entry.metadata ?? {}) as Record<string, unknown>;

            return (
              <li
                key={entry.id}
                className="rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-ink">
                    {ACTION_LABEL[entry.action] ?? entry.action}
                  </p>
                  <p className="identifier text-[0.6875rem] text-ink-300">
                    {entry.createdAt.toLocaleString("en-IN")}
                  </p>
                </div>

                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.6875rem] text-ink-500">
                  {meta.serialNo !== undefined && (
                    <div>
                      <dt className="inline text-ink-300">Register entry </dt>
                      <dd className="identifier inline">#{String(meta.serialNo)}</dd>
                    </div>
                  )}
                  {meta.orderNumber !== undefined && (
                    <div>
                      <dt className="inline text-ink-300">Order </dt>
                      <dd className="identifier inline">{String(meta.orderNumber)}</dd>
                    </div>
                  )}
                  {meta.drug !== undefined && (
                    <div>
                      <dt className="inline text-ink-300">Drug </dt>
                      <dd className="inline">{String(meta.drug)}</dd>
                    </div>
                  )}
                  {meta.prescriberRegNo !== undefined && meta.prescriberRegNo !== null && (
                    <div>
                      <dt className="inline text-ink-300">Prescriber </dt>
                      <dd className="identifier inline">
                        {String(meta.prescriberRegNo)}
                      </dd>
                    </div>
                  )}
                  {meta.reason !== undefined && (
                    <div className="w-full">
                      <dt className="inline text-ink-300">Reason </dt>
                      <dd className="inline">{String(meta.reason)}</dd>
                    </div>
                  )}
                </dl>

                {entry.ipAddress && (
                  <p className="identifier mt-1 text-[0.625rem] text-ink-300">
                    from {entry.ipAddress}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
