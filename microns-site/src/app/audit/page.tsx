import type { Metadata } from "next";
import { AuditForm } from "@/components/audit-form";
import { BookButton } from "@/components/ui";
import { auditChecks } from "@/content/copy";

export const metadata: Metadata = {
  title: "Request a revenue leak audit",
  description:
    "Five numbers that tell you where your clinic is losing bookings: missed calls, reply time, no-show rate, review velocity and where enquiries arrive. Free.",
  alternates: { canonical: "/audit" },
  openGraph: {
    title: "Request a revenue leak audit — Microns",
    description:
      "Five numbers that tell you where your clinic is losing bookings. Free, and useful even if you never hire us.",
    url: "/audit",
  },
};

export default function AuditPage() {
  return (
    <>
      <section className="mx-auto w-full max-w-[1400px] px-6 pb-16 pt-14 md:px-10 md:pb-20 md:pt-20 lg:px-16">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6">
            <h1 className="max-w-[16ch] text-display-1">
              Find the leak first.
            </h1>
            <p className="mt-8 max-w-[46ch] text-lead text-slate">
              Five questions, then five numbers back. It costs nothing and it is
              useful even if you never hire us — you can hand the answers to
              whoever you like.
            </p>
          </div>

          <dl className="border-t border-mist lg:col-span-5 lg:col-start-8">
            {auditChecks.map((c) => (
              <div key={c.label} className="border-b border-mist py-5">
                <dt className="text-[1.0625rem]">{c.label}</dt>
                <dd className="mt-1 max-w-[46ch] text-[0.9375rem] leading-relaxed text-slate">
                  {c.body}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-t border-mist">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-20 md:px-10 md:py-24 lg:px-16">
          <AuditForm />
        </div>
      </section>

      <section className="border-t border-mist">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-20 md:px-10 md:py-28 lg:px-16">
          <h2 className="max-w-[22ch] text-display-2">
            Would rather just talk it through?
          </h2>
          <p className="mt-7 max-w-[44ch] text-slate">
            The call covers the same ground and takes twenty minutes.
          </p>
          <div className="mt-9">
            <BookButton className="w-full sm:w-auto" />
          </div>
        </div>
      </section>
    </>
  );
}
