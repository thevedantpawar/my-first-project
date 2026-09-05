import type { Metadata } from "next";

import { db } from "@/lib/db";
import { AddPincodeForm, PincodeToggle } from "@/components/admin-tables";

export const metadata: Metadata = { title: "Serviceable pincodes", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminPincodesPage() {
  const pincodes = await db.serviceablePincode.findMany({ orderBy: { pincode: "asc" } });

  return (
    <div className="space-y-5">
      <AddPincodeForm />

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-ink-100">
        <table className="w-full min-w-[600px] border-collapse text-xs">
          <thead>
            <tr className="bg-pine-700 text-left text-paper">
              {["Pincode", "City", "State", "ETA", "COD", "Status"].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pincodes.map((p) => (
              <tr key={p.id} className="border-t border-ink-100 bg-paper-raised">
                <td className="identifier px-3 py-2 font-semibold text-pine-700">{p.pincode}</td>
                <td className="px-3 py-2 text-ink-700">{p.city}</td>
                <td className="px-3 py-2 text-ink-700">{p.state}</td>
                <td className="identifier px-3 py-2 text-ink-700">{p.etaHours}h</td>
                <td className="px-3 py-2 text-ink-700">{p.codAvailable ? "Yes" : "No"}</td>
                <td className="px-3 py-2">
                  <PincodeToggle pincode={p.pincode} isActive={p.isActive} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
