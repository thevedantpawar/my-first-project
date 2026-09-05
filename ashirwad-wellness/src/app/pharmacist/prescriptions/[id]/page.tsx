import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getPrescriptionForReview } from "@/lib/pharmacist";
import { PrescriptionViewer } from "@/components/prescription-viewer";
import { VerificationForm } from "@/components/verification-form";
import { policy } from "@/lib/pharmacy";
import { ScheduleType } from "@/generated/prisma/enums";
import { H1_CITATION } from "@/lib/schedule";

export const metadata: Metadata = {
  title: "Review prescription",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Side-by-side review.
 *
 * The image and the requested items sit next to each other on one screen,
 * because the question a pharmacist is answering is whether *this* prescription
 * covers *these* items. Making them scroll between the two invites error.
 */
export default async function ReviewPrescriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const prescription = await getPrescriptionForReview(id);
  if (!prescription) notFound();

  const requestedItems = prescription.cartItems;
  const hasH1 = requestedItems.some(
    (i) => i.product.scheduleType === ScheduleType.SCHEDULE_H1,
  );

  return (
    <div>
      <Link
        href="/pharmacist"
        className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-living-600"
      >
        <ArrowLeft aria-hidden="true" className="size-3" />
        Back to queue
      </Link>

      <div className="mt-3 grid gap-5 lg:grid-cols-2">
        {/* Left: the image. */}
        <div>
          <PrescriptionViewer
            prescriptionId={prescription.id}
            mimeType={prescription.mimeType}
          />
        </div>

        {/* Right: who it is for, what it is being used for, and the decision. */}
        <div className="space-y-4">
          <section className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
            <h2 className="text-sm font-semibold text-ink">Patient</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-ink-300">Name</dt>
                <dd className="text-ink-700">
                  {prescription.patient?.fullName ??
                    prescription.user.name ??
                    "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-300">Relation to account</dt>
                <dd className="text-ink-700">
                  {prescription.patient?.relation ?? "SELF"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-300">Account</dt>
                <dd className="text-ink-700">{prescription.user.email}</dd>
              </div>
              <div>
                <dt className="text-ink-300">Uploaded</dt>
                <dd className="identifier text-ink-700">
                  {prescription.uploadedAt.toLocaleString("en-IN")}
                </dd>
              </div>
            </dl>
          </section>

          <section
            className={`rounded-[var(--radius-card)] border border-ink-100 p-4 ${
              hasH1 ? "rx-gate" : "bg-paper-raised"
            }`}
          >
            <h2 className="text-sm font-semibold text-ink">
              Items this prescription is attached to
            </h2>

            {requestedItems.length === 0 ? (
              <p className="mt-2 text-xs text-ink-500">
                Not yet attached to any item. The customer may attach it after
                verification.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-ink-100">
                {requestedItems.map((item) => (
                  <li key={item.id} className="py-2">
                    <p className="text-sm text-ink">
                      <span className="identifier text-ink-300">
                        {item.quantity}×
                      </span>{" "}
                      {item.product.name}
                    </p>
                    <p className="text-xs text-ink-500">
                      {item.product.composition}
                      {item.product.strength && ` · ${item.product.strength}`} ·{" "}
                      {item.product.packSize}
                    </p>
                    {item.product.scheduleType === ScheduleType.SCHEDULE_H1 && (
                      <p className="identifier mt-0.5 text-[0.625rem] text-rx-700">
                        Schedule H1 — statutory register entry on dispensing
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {hasH1 && (
              <p className="identifier mt-3 border-t border-rx-100 pt-2 text-[0.625rem] leading-relaxed text-rx-700">
                {H1_CITATION}
              </p>
            )}
          </section>

          {prescription.orderItems.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-turmeric-500/40 bg-turmeric-50 p-4">
              <h2 className="text-sm font-semibold text-ink">
                Already dispensed against
              </h2>
              <ul className="mt-2 space-y-1">
                {prescription.orderItems.map((item) => (
                  <li key={item.id} className="text-xs text-ink-700">
                    <span className="identifier">{item.order.orderNumber}</span> ·{" "}
                    {item.quantity}× {item.nameSnapshot} ({item.order.status})
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.6875rem] text-ink-500">
                Terms cannot be changed once a prescription has been dispensed
                against. File a register correction instead.
              </p>
            </section>
          )}

          <VerificationForm
            prescriptionId={prescription.id}
            defaultValidityDays={policy.defaultPrescriptionValidityDays}
            initial={{
              doctorName: prescription.doctorName,
              doctorRegNo: prescription.doctorRegNo,
              hospitalName: prescription.hospitalName,
              issuedOn: prescription.issuedOn,
            }}
          />
        </div>
      </div>
    </div>
  );
}
