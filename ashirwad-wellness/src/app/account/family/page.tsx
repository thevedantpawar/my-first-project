import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PatientManager } from "@/components/account-forms";

export const metadata: Metadata = { title: "Family members", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function FamilyPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const patients = await db.patient.findMany({
    where: { userId: session.user.id },
    include: { _count: { select: { prescriptions: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="max-w-2xl">
      <p className="max-w-prose text-xs leading-relaxed text-ink-500">
        Prescriptions are often written for a relative. Naming the patient here
        means the pharmacist sees who a prescription is for, and the Schedule H1
        register records a consistent patient identity across repeats rather than
        a name retyped each time.
      </p>

      <div className="mt-4">
        <PatientManager
          patients={patients.map((p) => ({
            id: p.id,
            fullName: p.fullName,
            relation: p.relation,
            gender: p.gender,
            ageYears: p.ageYears,
            prescriptionCount: p._count.prescriptions,
          }))}
        />
      </div>
    </div>
  );
}
