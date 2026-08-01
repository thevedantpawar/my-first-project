"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, Trash2 } from "lucide-react";

import { getPrescriptionViewUrl, deletePrescription } from "@/actions/prescriptions";
import { PrescriptionStatus, Relation } from "@/generated/prisma/enums";

type Item = {
  id: string;
  status: PrescriptionStatus;
  uploadedAt: Date;
  verifiedAt: Date | null;
  validUntil: Date | null;
  rejectionReason: string | null;
  doctorName: string | null;
  doctorRegNo: string | null;
  mimeType: string | null;
  patientName: string | null;
  patientRelation: Relation | null;
  verifiedByName: string | null;
  verifiedByRegNo: string | null;
  dispensingsLeft: number;
  maxDispensings: number;
  expired: boolean;
  linkedOrders: {
    id: string;
    orderNumber: string;
    status: string;
    name: string;
    quantity: number;
  }[];
};

const STATUS_COPY: Record<PrescriptionStatus, { label: string; tone: string }> = {
  UPLOADED: { label: "Waiting for a pharmacist", tone: "bg-turmeric-100 text-turmeric-600" },
  UNDER_REVIEW: { label: "Being reviewed", tone: "bg-turmeric-100 text-turmeric-600" },
  VERIFIED: { label: "Verified", tone: "bg-living-100 text-living-600" },
  REJECTED: { label: "Rejected", tone: "bg-rx-500 text-paper" },
  CLARIFICATION_REQUESTED: { label: "Clearer image needed", tone: "bg-turmeric-500 text-ink-900" },
  EXPIRED: { label: "Expired", tone: "bg-ink-100 text-ink-500" },
  EXHAUSTED: { label: "No repeats left", tone: "bg-ink-100 text-ink-500" },
};

export function PrescriptionLibraryItem({ item }: { item: Item }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVerified = item.status === PrescriptionStatus.VERIFIED;
  // A verified prescription can still be unusable — expired, or out of repeats.
  const usable = isVerified && !item.expired && item.dispensingsLeft > 0;
  const status = STATUS_COPY[item.status];

  async function view() {
    setError(null);
    setOpening(true);
    const result = await getPrescriptionViewUrl({ prescriptionId: item.id });
    setOpening(false);
    if (result.ok) window.open(result.data.url, "_blank", "noopener,noreferrer");
    else setError(result.error);
  }

  return (
    <li
      className={`rounded-[var(--radius-card)] border border-ink-100 p-4 ${
        usable ? "rx-gate" : "bg-paper-raised"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {item.patientName ?? "For yourself"}
            {item.patientRelation && item.patientRelation !== Relation.SELF && (
              <span className="ml-1 text-xs font-normal text-ink-500">
                ({item.patientRelation.toLowerCase()})
              </span>
            )}
          </p>
          <p className="text-xs text-ink-500">
            {item.doctorName ?? "Prescriber not recorded"}
            {item.doctorRegNo && <span className="identifier"> · {item.doctorRegNo}</span>}
          </p>
          <p className="identifier text-[0.625rem] text-ink-300">
            Uploaded {item.uploadedAt.toLocaleDateString("en-IN")}
          </p>
        </div>

        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${status.tone}`}>
          {status.label}
        </span>
      </div>

      {isVerified && (
        <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-rx-100 pt-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-ink-300">Valid until</dt>
            <dd className={`identifier ${item.expired ? "text-rx-700" : "text-ink-700"}`}>
              {item.validUntil ? item.validUntil.toLocaleDateString("en-IN") : "—"}
              {item.expired && " (expired)"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-300">Supplies left</dt>
            <dd
              className={`identifier ${item.dispensingsLeft === 0 ? "text-rx-700" : "text-ink-700"}`}
            >
              {item.dispensingsLeft} of {item.maxDispensings}
            </dd>
          </div>
          <div>
            <dt className="text-ink-300">Verified by</dt>
            <dd className="text-ink-700">
              {item.verifiedByName ?? "—"}
              {item.verifiedByRegNo && (
                <span className="identifier block text-[0.625rem] text-ink-300">
                  {item.verifiedByRegNo}
                </span>
              )}
            </dd>
          </div>
        </dl>
      )}

      {item.rejectionReason && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-rx-50 p-2.5 text-xs text-rx-700">
          <strong className="font-semibold">Pharmacist&rsquo;s note:</strong>{" "}
          {item.rejectionReason}
        </p>
      )}

      {item.linkedOrders.length > 0 && (
        <div className="mt-3 border-t border-ink-100 pt-2">
          <p className="text-[0.6875rem] font-semibold text-ink-500">Dispensed against</p>
          <ul className="mt-1 space-y-0.5">
            {item.linkedOrders.map((o) => (
              <li key={o.id} className="text-[0.6875rem] text-ink-500">
                <Link
                  href={`/account/orders/${o.orderNumber}`}
                  className="identifier text-pine-700 hover:underline"
                >
                  {o.orderNumber}
                </Link>{" "}
                · {o.quantity}× {o.name} ({o.status.toLowerCase().replace(/_/g, " ")})
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-rx-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void view()}
          disabled={opening}
          className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-pine-50"
        >
          {opening ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Eye aria-hidden="true" className="size-3.5" />
          )}
          View
        </button>

        {/* Deletion is refused server-side once dispensed against — the record
            is part of the dispensing trail at that point. */}
        {item.linkedOrders.length === 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deletePrescription({ prescriptionId: item.id });
                if (result.ok) router.refresh();
                else setError(result.error);
              })
            }
            className="flex items-center gap-1 text-xs text-ink-500 hover:text-rx-700"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            Delete
          </button>
        )}

        {usable && (
          <span className="text-[0.6875rem] text-living-600">
            Ready to attach at checkout
          </span>
        )}
      </div>
    </li>
  );
}
