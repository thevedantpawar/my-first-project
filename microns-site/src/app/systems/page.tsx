import type { Metadata } from "next";
import { CtaClose } from "@/components/cta-close";
import { systems } from "@/content/copy";
import { SystemVisual } from "@/components/system-visual";

export const metadata: Metadata = {
  title: "The five systems",
  description:
    "Speed-to-lead reply, no-show prevention, no-show recovery, review requests and after-hours front desk handoff — what each one does, when it fires and what your client sees.",
  alternates: { canonical: "/systems" },
  openGraph: {
    title: "The five systems — Microns",
    description:
      "What each system does, when it fires, what your client experiences and what it connects to.",
    url: "/systems",
    images: ["/opengraph-image"],
  },
};

const rows = [
  { label: "Runs when", key: "trigger" },
  { label: "Timing", key: "timing" },
  { label: "Your client experiences", key: "experience" },
  { label: "Connects to", key: "connects" },
] as const;

export default function SystemsPage() {
  return (
    <>
      <section className="mx-auto w-full max-w-[1400px] px-6 pb-16 pt-14 md:px-10 md:pb-24 md:pt-20 lg:px-16">
        <h1 className="max-w-[18ch] text-display-1">Five systems, one at a time.</h1>
        <p className="mt-9 max-w-[54ch] text-lead text-slate">
          Each one closes a specific gap between an enquiry and a booking. They
          run on top of the software you already have, and none of them adds a
          task to your front desk&rsquo;s day.
        </p>
      </section>

      {systems.map((s) => (
        <section
          key={s.slug}
          id={s.slug}
          className="scroll-mt-24 border-t border-mist"
        >
          <div className="mx-auto w-full max-w-[1400px] px-6 py-20 md:px-10 md:py-28 lg:px-16 lg:py-32">
            <div className="grid gap-10 md:grid-cols-12">
              <div className="md:col-span-4">
                <p className="tnum text-meta text-micron">{s.n}</p>
                <h2 className="mt-4 max-w-[14ch] text-display-2">{s.name}</h2>
              </div>

              <div className="md:col-span-7 md:col-start-6">
                <p className="max-w-[48ch] text-lead">{s.does}</p>

                <SystemVisual visual={s.visual} className="mt-10" />

                <dl className="mt-12 border-t border-mist">
                  {rows.map((r) => (
                    <div
                      key={r.label}
                      className="grid gap-1 border-b border-mist py-5 md:grid-cols-5 md:gap-8"
                    >
                      <dt className="text-meta text-slate md:col-span-2">
                        {r.label}
                      </dt>
                      <dd className="max-w-[52ch] md:col-span-3">{s[r.key]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>
      ))}

      <CtaClose />
    </>
  );
}
