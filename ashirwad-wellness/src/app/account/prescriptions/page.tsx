import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PrescriptionUpload } from "@/components/prescription-upload";
import { PrescriptionLibraryItem } from "@/components/prescription-library";
import { PrescriptionStatus, OrderStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = {
  title: "Your prescriptions",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Prescription library.
 *
 * Shows the remaining dispensing budget alongside each verified prescription,
 * computed the same way the Rx gate computes it — from OrderItem rather than a
 * counter — so the customer is never told they have a repeat left when checkout
 * would refuse it.
 */
export default async function PrescriptionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const prescriptions = await db.prescription.findMany({
    where: { userId: session.user.id },
    include: {
      patient: { select: { fullName: true, relation: true } },
      verifiedBy: { select: { name: true, pharmacistRegNo: true } },
      orderItems: {
        select: {
          id: true,
          nameSnapshot: true,
          quantity: true,
          order: { select: { orderNumber: true, status: true } },
        },
      },
    },
    orderBy: { uploadedAt: "desc" },
  });

  // Same statuses the gate counts as consuming a supply.
  const consuming = new Set<OrderStatus>([
    OrderStatus.PENDING_PHARMACIST_REVIEW,
    OrderStatus.AWAITING_PAYMENT,
    OrderStatus.CONFIRMED,
    OrderStatus.PACKED,
    OrderStatus.SHIPPED,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
  ]);

  const items = prescriptions.map((p) => {
    const dispensed = p.orderItems.filter((i) => consuming.has(i.order.status)).length;
    const maxDispensings = p.refillsAllowed + 1;
    const expired = p.validUntil !== null && p.validUntil < new Date();

    return {
      id: p.id,
      status: p.status,
      uploadedAt: p.uploadedAt,
      verifiedAt: p.verifiedAt,
      validUntil: p.validUntil,
      rejectionReason: p.rejectionReason,
      doctorName: p.doctorName,
      doctorRegNo: p.doctorRegNo,
      mimeType: p.mimeType,
      patientName: p.patient?.fullName ?? null,
      patientRelation: p.patient?.relation ?? null,
      verifiedByName: p.verifiedBy?.name ?? null,
      verifiedByRegNo: p.verifiedBy?.pharmacistRegNo ?? null,
      dispensingsLeft: Math.max(0, maxDispensings - dispensed),
      maxDispensings,
      expired,
      linkedOrders: p.orderItems.map((i) => ({
        id: i.id,
        orderNumber: i.order.orderNumber,
        status: i.order.status,
        name: i.nameSnapshot,
        quantity: i.quantity,
      })),
    };
  });

  const pending = items.filter(
    (i) =>
      i.status === PrescriptionStatus.UPLOADED ||
      i.status === PrescriptionStatus.UNDER_REVIEW,
  );

  return (
    <div className="max-w-3xl">
      <p className="flex max-w-prose items-start gap-2 text-xs leading-relaxed text-ink-500">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-living-600" />
        Prescriptions are stored privately and are visible only to you and the
        registered pharmacist reviewing them. Every time one is opened, that
        access is recorded.
      </p>

      {pending.length > 0 && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-turmeric-50 p-2.5 text-xs text-ink-700">
          <span className="identifier font-semibold">{pending.length}</span>{" "}
          prescription{pending.length === 1 ? " is" : "s are"} waiting for a
          pharmacist. We will email you when the review is done.
        </p>
      )}

      <div className="mt-5 rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Upload a prescription</h2>
        <div className="mt-3">
          <PrescriptionUpload />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-5 rounded-[var(--radius-card)] border border-dashed border-ink-100 p-10 text-center text-sm text-ink-500">
          You have not uploaded any prescriptions yet.
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {items.map((item) => (
            <PrescriptionLibraryItem key={item.id} item={item} />
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-ink-500">
        Need to order something?{" "}
        <Link href="/category/medicines" className="text-living-600 hover:underline">
          Browse medicines
        </Link>
      </p>
    </div>
  );
}
