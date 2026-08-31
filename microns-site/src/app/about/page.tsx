import type { Metadata } from "next";
import { CtaClose } from "@/components/cta-close";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Microns builds and runs front-desk automation for med spas. You talk to the team that builds your system and answers when something breaks.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About — Microns",
    description:
      "The team that scopes your system builds it, and answers when something breaks.",
    url: "/about",
    images: ["/opengraph-image"],
  },
};

const { firstName, lastName, city } = site.founder;
const fullName = `${firstName} ${lastName}`;

export default function AboutPage() {
  return (
    <>
      <section className="mx-auto w-full max-w-[1400px] px-6 pb-16 pt-14 md:px-10 md:pb-24 md:pt-20 lg:px-16">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-8">
            <h1 className="max-w-[16ch] text-display-1">
              We build one thing, for one industry.
            </h1>
          </div>
        </div>
      </section>

      <section className="border-t border-mist">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-20 md:px-10 md:py-28 lg:px-16">
          <div className="grid gap-10 md:grid-cols-12">
            <div className="md:col-span-3">
              <p className="text-meta text-micron">01</p>
              <p className="mt-2 text-meta text-slate">Who</p>
            </div>

            <div className="max-w-[58ch] md:col-span-8 md:col-start-5">
              <p className="text-lead">
                Microns is an automation studio for med spas, founded by{" "}
                {fullName}
                {city ? ` in ${city}` : ""}. We are small on purpose: you talk
                to the people who build your system, and to the people who
                answer when something breaks.
              </p>

              {/*
                TODO — rewrite this paragraph in your own words before launch.
                It is written as an argument rather than a personal story so
                that nothing here is invented on your behalf.
              */}
              <p className="mt-8 text-slate">
                Med spas, specifically, because the gap is unusually wide. A
                clinic spends real money getting someone to call, then loses the
                booking because nobody picked up at 7pm on a Tuesday. The
                treatments are high value, the enquiry volume is small enough to
                handle properly, and the decision is usually made within the
                hour. That combination makes the front desk the most expensive
                unattended part of the business, and the one you can fix without
                touching anything clinical.
              </p>

              <p className="mt-8 text-slate">
                It also means we take on a limited number of builds at a time.
                If the timing does not work, we will tell you on the call rather
                than three weeks in.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-mist">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-20 md:px-10 md:py-28 lg:px-16">
          <div className="grid gap-10 md:grid-cols-12">
            <div className="md:col-span-3">
              <p className="text-meta text-micron">02</p>
              <p className="mt-2 text-meta text-slate">How it goes</p>
            </div>

            <dl className="border-t border-mist md:col-span-8 md:col-start-5">
              {[
                {
                  t: "You talk to the builders",
                  d: "No account manager, no handover. Nothing gets lost between the person who scoped it and the person who wrote it.",
                },
                {
                  t: "You approve every message",
                  d: "Nothing goes to one of your clients until you have read it and said yes. Your voice, your offers, your rules on what gets promised.",
                },
                {
                  t: "Nothing clinical is automated",
                  d: "Anything that needs a practitioner is flagged for a human. The systems handle admin, timing and follow-up, not advice.",
                },
                {
                  t: "You can leave",
                  d: "Month to month. The systems run in your own accounts, so what has been built stays yours.",
                },
              ].map((r) => (
                <div
                  key={r.t}
                  className="grid gap-2 border-b border-mist py-6 md:grid-cols-5 md:gap-8"
                >
                  <dt className="text-[1.0625rem] md:col-span-2">{r.t}</dt>
                  <dd className="max-w-[52ch] text-slate md:col-span-3">
                    {r.d}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <CtaClose />
    </>
  );
}
