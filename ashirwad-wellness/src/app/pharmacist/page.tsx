import Link from "next/link";
import type { Metadata } from "next";
import { Clock, Inbox } from "lucide-react";

import { getPrescriptionQueue } from "@/lib/pharmacist";
import { RxBadge } from "@/components/rx-gate";
import { ScheduleType } from "@/generated/prisma/enums";

export const metadata: Metadata = {
  title: "Verification queue",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function waitingFor(uploadedAt: Date): string {
  const hours = Math.floor((Date.now() - uploadedAt.getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default async function PrescriptionQueuePage() {
  const queue = await getPrescriptionQueue();

  if (queue.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-ink-100 p-12 text-center">
        <Inbox aria-hidden="true" className="mx-auto size-8 text-ink-300" />
        <p className="mt-2 text-sm text-ink-700">No prescriptions waiting.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-ink-500">
        <span className="identifier">{queue.length}</span> prescription
        {queue.length === 1 ? "" : "s"} waiting, oldest first.
      </p>

      <ul className="mt-4 space-y-3">
        {queue.map((prescription) => {
          const hasH1 = prescription.cartItems.some(
            (i) => i.product.scheduleType === ScheduleType.SCHEDULE_H1,
          );

          return (
            <li
              key={prescription.id}
              className={`rounded-[var(--radius-card)] border border-ink-100 p-4 ${
                hasH1 ? "rx-gate" : "bg-paper-raised"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {prescription.patient?.fullName ??
                      prescription.user.name ??
                      "Unnamed customer"}
                  </p>
                  <p className="text-xs text-ink-500">
                    {prescription.user.email}
                    {prescription.patient &&
                      prescription.patient.relation !== "SELF" &&
                      ` · for ${prescription.patient.relation.toLowerCase()}`}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-ink-300">
                    <Clock aria-hidden="true" className="size-3" />
                    Waiting {waitingFor(prescription.uploadedAt)}
                    {prescription.doctorName && ` · ${prescription.doctorName}`}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {hasH1 && <RxBadge />}
                  <Link
                    href={`/pharmacist/prescriptions/${prescription.id}`}
                    className="rounded-[var(--radius-control)] bg-pine-700 px-3 py-1.5 text-sm font-semibold text-paper hover:bg-pine-900"
                  >
                    Review
                  </Link>
                </div>
              </div>

              {prescription.cartItems.length > 0 && (
                <ul className="mt-3 border-t border-ink-100 pt-2">
                  {prescription.cartItems.map((item, i) => (
                    <li key={i} className="text-xs text-ink-700">
                      <span className="identifier text-ink-300">
                        {item.quantity}×
                      </span>{" "}
                      {item.product.name}{" "}
                      <span className="text-ink-300">
                        ({item.product.composition})
                      </span>
                      {item.product.scheduleType === ScheduleType.SCHEDULE_H1 && (
                        <span className="ml-1 font-semibold text-rx-700">H1</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
