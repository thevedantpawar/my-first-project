import type { Metadata } from "next";

import { getStaff } from "@/lib/admin";
import { RegNoEditor } from "@/components/admin-tables";
import { pharmacy } from "@/lib/pharmacy";

export const metadata: Metadata = { title: "Staff", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const staff = await getStaff();

  return (
    <div>
      <p className="max-w-prose text-xs leading-relaxed text-ink-500">
        A pharmacist cannot verify a prescription or approve an order until a
        registration number is recorded here — that value is stamped onto every
        Schedule H1 register entry they sign off, so it must be a real,
        registered number from the {pharmacy.pharmacistCouncil}.
      </p>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-ink-100">
        <table className="w-full min-w-[680px] border-collapse text-xs">
          <thead>
            <tr className="bg-pine-700 text-left text-paper">
              {["Name", "Email", "Role", "Registration number", "Active"].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const unset = !s.pharmacistRegNo || s.pharmacistRegNo.startsWith("REPLACE_ME");
              return (
                <tr key={s.id} className={`border-t border-ink-100 ${unset && s.role === "PHARMACIST" ? "rx-gate" : "bg-paper-raised"}`}>
                  <td className="px-3 py-2 text-ink">{s.name ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-700">{s.email}</td>
                  <td className="px-3 py-2 text-ink-700">{s.role}</td>
                  <td className="px-3 py-2">
                    <RegNoEditor userId={s.id} current={s.pharmacistRegNo} />
                    {unset && s.role === "PHARMACIST" && (
                      <p className="mt-1 text-[0.625rem] font-semibold text-rx-700">
                        Verification blocked until this is set.
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-700">{s.isActive ? "Yes" : "No"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
