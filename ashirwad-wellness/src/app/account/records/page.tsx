import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { HealthRecordManager } from "@/components/account-forms";

export const metadata: Metadata = { title: "Health records", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function RecordsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const records = await db.healthRecord.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="max-w-2xl">
      <p className="flex max-w-prose items-start gap-2 text-xs leading-relaxed text-ink-500">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-living-600" />
        Health records are stored in private object storage and are visible only
        to you. Unlike prescriptions, our pharmacists cannot open them — a lab
        report is not a pharmacist&rsquo;s business.
      </p>

      <div className="mt-4">
        <HealthRecordManager
          records={records.map((r) => ({
            id: r.id,
            title: r.title,
            mimeType: r.mimeType,
            recordDate: r.recordDate,
            notes: r.notes,
            createdAt: r.createdAt,
          }))}
        />
      </div>
    </div>
  );
}
