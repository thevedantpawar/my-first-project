import Link from "next/link";
import type { Metadata } from "next";
import { Hero } from "@/components/hero";
import { Faq } from "@/components/faq";
import { CtaClose } from "@/components/cta-close";
import { Section, Measure, TextLink } from "@/components/ui";
import { auditChecks, problems, steps, systems } from "@/content/copy";
import { site } from "@/content/site";
import { HomeJsonLd } from "@/components/json-ld";
import { SystemVisual } from "@/components/system-visual";

export const metadata: Metadata = {
  title: "Microns — automation systems for med spas",
  description:
    "Microns builds the automation layer that catches the calls, leads and no-shows your med spa is currently losing. Book a 20-minute call.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Microns — automation systems for med spas",
    description:
      "The front desk can't answer every call. The system can. Automation that recovers the bookings your clinic is losing.",
    url: "/",
    images: ["/opengraph-image"],
  },
};

export default function Home() {
  return (
    <>
      <HomeJsonLd />
      <Hero />

      {/* The hero instrument, made concrete: the message itself. */}
      <section className="border-t border-mist bg-mist/45">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-20 md:px-10 md:py-24 lg:px-16">
          <div className="grid items-center gap-12 md:grid-cols-12 md:gap-10">
            <div className="md:col-span-5">
              <h2 className="max-w-[18ch] text-display-2">
                This is what 21:47 looks like when the system is on.
              </h2>
              <p className="mt-7 max-w-[42ch] text-slate">
                The enquiry that arrives after you close does not wait until
                morning. It gets a real answer, in your words, while the person
                is still deciding.
              </p>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <SystemVisual visual={systems[0].visual} />
            </div>
          </div>
        </div>
      </section>

      {/* 5.2 — the problem, as money. Three statements, no cards. */}
      <Section index="01" label="What it costs you">
        <Measure className="max-w-[54ch]">
          <h2 className="text-display-2">
            The bookings are already there. They leave before anyone answers.
          </h2>
        </Measure>
        <dl className="mt-16 max-w-[76ch] border-t border-mist">
          {problems.map((p) => (
            <div
              key={p.claim}
              className="grid gap-2 border-b border-mist py-9 md:grid-cols-5 md:gap-10"
            >
              <dt className="text-display-3 md:col-span-2">{p.claim}</dt>
              <dd className="text-slate md:col-span-3">{p.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* 5.3 — five systems as a stepped list carrying real trigger metadata. */}
      <Section index="02" label="What we build">
        <Measure className="max-w-[52ch]">
          <h2 className="text-display-2">Five systems. All of them built already.</h2>
          <p className="mt-7 text-slate">
            You do not start with all five. The audit tells you which one is
            losing you the most, and that is the one we build first.
          </p>
        </Measure>

        <ol className="mt-16 list-none border-t border-mist p-0">
          {systems.map((s) => (
            <li key={s.slug} className="border-b border-mist">
              <Link
                href={`/systems#${s.slug}`}
                className="group grid gap-x-10 gap-y-4 py-9 md:grid-cols-12"
              >
                <span className="tnum text-meta text-micron md:col-span-1">
                  {s.n}
                </span>
                <span className="md:col-span-4">
                  <span className="block text-display-3 transition-colors group-hover:text-micron">
                    {s.name}
                  </span>
                </span>
                <span className="max-w-[52ch] text-slate md:col-span-4">
                  {s.short}
                </span>
                <span className="md:col-span-3">
                  <span className="block text-meta text-slate">
                    <span className="sr-only">Runs when: </span>
                    {s.trigger}
                  </span>
                  <span className="mt-1 block text-meta">
                    <span className="sr-only">Timing: </span>
                    {s.timing}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <p className="mt-10">
          <TextLink href="/systems">See how each one works</TextLink>
        </p>
      </Section>

      {/* 5.4 — how it works. A real sequence, so numbering is earned. */}
      <Section index="03" label="How it works">
        <Measure className="max-w-[52ch]">
          <h2 className="text-display-2">Audit, build, run.</h2>
        </Measure>
        <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
          {steps.map((s) => (
            <div key={s.n} className="border-t border-ink pt-6">
              <p className="tnum text-meta text-micron">{s.n}</p>
              <h3 className="mt-4 text-display-3">{s.name}</h3>
              <p className="mt-4 text-slate">{s.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 5.7 option B — the audit is the proof. Given the page's one dark band. */}
      <section className="on-ink border-t border-ink bg-ink text-porcelain">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-24 md:px-10 md:py-32 lg:px-16 lg:py-40">
          <div className="grid gap-14 md:grid-cols-12 md:gap-10">
            <div className="md:col-span-5">
              <h2 className="text-display-2">
                What the free audit actually looks at.
              </h2>
              <p className="mt-8 max-w-[40ch] text-[color:var(--color-slate-inverse)]">
                No client logos here, because there is no honest way to show
                them yet. This is the work instead. If these five numbers look
                fine, there is nothing here worth paying for and we will tell
                you that.
              </p>
              <p className="mt-8">
                <Link
                  href="/audit"
                  data-cta="audit"
                  className="plausible-event-name=Audit+request inline-flex min-h-[44px] items-center underline decoration-[color:var(--color-slate-inverse)] underline-offset-[6px] transition-colors hover:decoration-porcelain"
                >
                  Request the audit
                </Link>
              </p>
            </div>

            <dl className="border-t border-white/15 md:col-span-6 md:col-start-7">
              {auditChecks.map((c) => (
                <div
                  key={c.label}
                  className="grid gap-1 border-b border-white/15 py-6 md:grid-cols-5 md:gap-8"
                >
                  <dt className="text-[1.0625rem] md:col-span-2">{c.label}</dt>
                  <dd className="text-[0.9375rem] leading-relaxed text-[color:var(--color-slate-inverse)] md:col-span-3">
                    {c.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* 5.5 — price, said out loud. */}
      <Section index="04" label="What it costs">
        <div className="grid gap-12 md:grid-cols-12 md:gap-10">
          <div className="md:col-span-6">
            <h2 className="text-display-2">
              Most builds land between {site.pricing.rangeLow} and{" "}
              {site.pricing.rangeHigh}.
            </h2>
            <p className="mt-8 max-w-[44ch] text-slate">
              It depends on how many systems you start with. We&rsquo;ll give
              you an exact number on the call — not after three meetings.
            </p>
          </div>
          <div className="md:col-span-5 md:col-start-8">
          <dl className="border-t border-mist">
            <div className="flex items-baseline justify-between gap-6 border-b border-mist py-5">
              <dt className="text-slate">Build</dt>
              <dd className="tnum text-[1.0625rem]">
                {site.pricing.rangeLow}–{site.pricing.rangeHigh} one-time
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 border-b border-mist py-5">
              <dt className="text-slate">Ongoing</dt>
              <dd className="tnum text-[1.0625rem]">
                {site.pricing.monthly}/month
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 border-b border-mist py-5">
              <dt className="text-slate">Commitment</dt>
              <dd className="text-[1.0625rem]">Month to month</dd>
            </div>
          </dl>
            <p className="pt-5 text-meta text-slate">
              Monitoring, fixes and copy changes are included in the monthly.
              No annual contract.
            </p>
          </div>
        </div>
      </Section>

      {/* 5.6 — objections. */}
      <Section index="05" label="Questions">
        <div className="grid gap-10 md:grid-cols-12 md:gap-10">
          <div className="md:col-span-4">
            <h2 className="text-display-2">The things owners ask first.</h2>
          </div>
          <div className="md:col-span-7 md:col-start-6">
            <Faq />
          </div>
        </div>
      </Section>

      <CtaClose />
    </>
  );
}
