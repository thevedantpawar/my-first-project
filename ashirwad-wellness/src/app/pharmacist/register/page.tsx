import type { Metadata } from "next";
import { BookLock } from "lucide-react";

import { getH1RegisterEntries } from "@/lib/pharmacist";

export const metadata: Metadata = {
  title: "Schedule H1 register",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The Schedule H1 register — Rule 65(11A).
 *
 * Read-only by construction: the database rejects UPDATE and DELETE on this
 * table, so there is nothing to render an edit control for. A correcting entry
 * appears as its own row pointing at the one it corrects.
 */
export default async function RegisterPage() {
  const entries = await getH1RegisterEntries({ take: 200 });

  const correctedSerials = new Set(
    entries.filter((e) => e.corrects).map((e) => e.corrects!.serialNo),
  );

  return (
    <div>
      <div className="flex items-start gap-2">
        <BookLock aria-hidden="true" className="mt-0.5 size-4 text-rx-500" />
        <div>
          <h2 className="text-base text-ink">Schedule H1 register</h2>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-ink-500">
            Rule 65(11A), Drugs and Cosmetics Rules 1945. Entries are permanent
            — the database rejects any attempt to edit or delete one. An error
            is corrected by filing a further entry that references the original,
            which stays visible. Retained for three years and open to inspection.
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-ink-100 p-12 text-center text-sm text-ink-500">
          No Schedule H1 medicines have been dispensed yet.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-ink-100">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <caption className="sr-only">
              Schedule H1 dispensing register, most recent first
            </caption>
            <thead>
              <tr className="bg-pine-700 text-left text-paper">
                {[
                  "Sl. No.",
                  "Dispensed",
                  "Patient",
                  "Drug / strength",
                  "Qty",
                  "Batch / expiry",
                  "Prescriber",
                  "Pharmacist",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isCorrection = Boolean(entry.correctsEntryId);
                const wasCorrected = correctedSerials.has(entry.serialNo);

                return (
                  <tr
                    key={entry.id}
                    className={`border-t border-ink-100 ${
                      isCorrection
                        ? "bg-turmeric-50"
                        : wasCorrected
                          ? "bg-paper-sunk text-ink-500"
                          : "bg-paper-raised"
                    }`}
                  >
                    <td className="px-3 py-2 align-top">
                      <span className="identifier font-semibold">
                        {entry.serialNo}
                      </span>
                      {isCorrection && (
                        <span className="mt-0.5 block text-[0.625rem] font-semibold text-turmeric-600">
                          corrects #{entry.corrects?.serialNo}
                        </span>
                      )}
                      {wasCorrected && (
                        <span className="mt-0.5 block text-[0.625rem] text-ink-300">
                          superseded
                        </span>
                      )}
                    </td>
                    <td className="identifier px-3 py-2 align-top">
                      {entry.dispensedAt.toLocaleDateString("en-IN")}
                      <span className="block text-[0.625rem] text-ink-300">
                        {entry.order.orderNumber}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {entry.patientName}
                      {entry.patientAge && (
                        <span className="block text-[0.625rem] text-ink-300">
                          {entry.patientAge} yrs
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {entry.drugName}
                      <span className="block text-[0.625rem] text-ink-300">
                        {entry.composition}
                      </span>
                    </td>
                    <td className="identifier px-3 py-2 align-top font-semibold">
                      {entry.quantity}
                    </td>
                    <td className="identifier px-3 py-2 align-top">
                      {entry.batchNumber ?? "—"}
                      <span className="block text-[0.625rem] text-ink-300">
                        {entry.expiryDate
                          ? entry.expiryDate.toLocaleDateString("en-IN")
                          : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {entry.prescriberName}
                      <span className="identifier block text-[0.625rem] text-ink-300">
                        {entry.prescriberRegNo}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {entry.pharmacistName}
                      <span className="identifier block text-[0.625rem] text-ink-300">
                        {entry.pharmacistRegNo}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
