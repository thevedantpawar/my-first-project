import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";

import { getOrderForReview } from "@/lib/pharmacist";
import { PrescriptionViewer } from "@/components/prescription-viewer";
import { OrderReviewForm } from "@/components/order-review-form";
import { formatPaise } from "@/lib/money";
import { ScheduleType, PrescriptionStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = {
  title: "Review order",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReviewOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrderForReview(id);
  if (!order) notFound();

  const h1Lines = order.items
    .filter((i) => i.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1)
    .map((i) => ({
      orderItemId: i.id,
      name: i.nameSnapshot,
      quantity: i.quantity,
      composition: i.compositionSnapshot,
      knownBatches: i.product.batches.map((b) => ({
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate.toISOString().slice(0, 10),
      })),
    }));

  // One viewer per distinct prescription attached to the order.
  const prescriptions = [
    ...new Map(
      order.items
        .filter((i) => i.prescription)
        .map((i) => [i.prescription!.id, i.prescription!]),
    ).values(),
  ];

  const address = order.shipAddressSnapshot as Record<string, string | null>;

  return (
    <div>
      <Link
        href="/pharmacist/orders"
        className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-living-600"
      >
        <ArrowLeft aria-hidden="true" className="size-3" />
        Back to orders
      </Link>

      <div className="mt-3 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          {prescriptions.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-ink-100 p-8 text-center text-sm text-ink-500">
              No prescription is attached to this order.
            </div>
          ) : (
            prescriptions.map((prescription) => (
              <div key={prescription.id}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-ink-500">
                    {prescription.doctorName ?? "Prescriber not recorded"}
                    {prescription.doctorRegNo && (
                      <span className="identifier"> · {prescription.doctorRegNo}</span>
                    )}
                  </p>
                  {prescription.status !== PrescriptionStatus.VERIFIED && (
                    <span className="rounded-full bg-rx-500 px-2 py-0.5 text-[0.625rem] font-bold uppercase text-paper">
                      {prescription.status}
                    </span>
                  )}
                </div>
                <PrescriptionViewer
                  prescriptionId={prescription.id}
                  mimeType={null}
                />
              </div>
            ))
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="identifier text-sm font-semibold text-pine-700">
                {order.orderNumber}
              </h2>
              <span className="identifier text-sm text-ink-700">
                {formatPaise(order.totalPaise)}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-500">
              {order.user.name} · {order.user.email}
            </p>
            <p className="text-xs text-ink-500">
              {address.city}, {address.state}{" "}
              <span className="identifier">{address.pincode}</span>
            </p>

            <ul className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
              {order.items.map((item) => {
                const isRx =
                  item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H ||
                  item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1;

                return (
                  <li key={item.id} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-ink">
                          <span className="identifier text-ink-300">
                            {item.quantity}×
                          </span>{" "}
                          {item.nameSnapshot}
                        </p>
                        <p className="text-xs text-ink-500">
                          {item.compositionSnapshot} · {item.packSizeSnapshot}
                        </p>
                      </div>
                      {isRx && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-bold ${
                            item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1
                              ? "bg-rx-500 text-paper"
                              : "bg-rx-100 text-rx-700"
                          }`}
                        >
                          {item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1
                            ? "H1"
                            : "H"}
                        </span>
                      )}
                    </div>

                    {isRx && !item.prescription && (
                      <p className="mt-1 flex items-center gap-1 text-[0.6875rem] text-rx-700">
                        <AlertTriangle aria-hidden="true" className="size-3" />
                        No prescription attached to this line.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <OrderReviewForm orderId={order.id} h1Lines={h1Lines} />
        </div>
      </div>
    </div>
  );
}
