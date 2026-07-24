import { plans, eliteOffer } from "@/lib/site";
import { CheckIcon, ArrowIcon } from "./Icons";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

export function Plans() {
  return (
    <section
      id="plans"
      className="relative overflow-hidden border-y border-white/5 bg-ink-soft py-24 sm:py-32"
    >
      <div className="absolute inset-0 bg-[radial-gradient(50%_40%_at_50%_0%,rgba(183,255,0,0.1),transparent_60%)]" />
      <div className="shell relative">
        <SectionHeading
          center
          eyebrow="Membership"
          title={
            <>
              Choose your <span className="text-lime">prescription</span>
            </>
          }
          intro="Annual memberships with early-bird pricing. Flexible monthly plans available too — no long lock-ins."
        />

        <div className="mx-auto mt-14 grid max-w-3xl gap-6 sm:grid-cols-2">
          {plans.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 0.08}>
              <div
                className={`glass relative flex h-full flex-col p-8 transition-transform duration-300 hover:-translate-y-1 ${
                  plan.featured
                    ? "border-lime/50 bg-lime/[0.06] shadow-glow"
                    : ""
                }`}
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-lime px-4 py-1 text-xs font-semibold uppercase tracking-wide text-ink">
                    Most Popular
                  </span>
                )}
                <div className="text-sm font-medium uppercase tracking-wide text-white/50">
                  {plan.name}
                </div>
                <div className="mt-1 text-sm text-lime/90">{plan.tagline}</div>
                <div className="mt-5 flex items-end gap-1">
                  <span className="font-display text-5xl font-bold">
                    {plan.price}
                  </span>
                  <span className="mb-1.5 text-white/50">{plan.period}</span>
                </div>

                <ul className="mt-7 flex-1 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime/15 text-lime">
                        <CheckIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-white/70">{f}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href="#contact"
                  className={`mt-8 w-full ${
                    plan.featured ? "btn-primary" : "btn-ghost"
                  }`}
                >
                  Get started
                  <ArrowIcon className="h-4 w-4" />
                </a>
              </div>
            </Reveal>
          ))}
        </div>

        {/* 5-year exclusive banner */}
        <Reveal delay={0.2}>
          <div className="glass mx-auto mt-6 flex max-w-3xl flex-col items-center gap-4 border-lime/30 bg-lime/[0.04] p-6 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-lime">
                {eliteOffer.name}
              </div>
              <p className="mt-1 text-sm text-white/60">{eliteOffer.note}</p>
            </div>
            <div className="flex items-center gap-5">
              <span className="font-display text-3xl font-bold sm:text-4xl">
                {eliteOffer.price}
              </span>
              <a href="#contact" className="btn-primary shrink-0">
                Claim offer
                <ArrowIcon className="h-4 w-4" />
              </a>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.26}>
          <p className="mt-8 text-center text-sm text-white/45">
            Not sure which fits?{" "}
            <a href="#contact" className="text-lime underline-offset-4 hover:underline">
              Book a free consultation
            </a>{" "}
            and we&apos;ll prescribe the right plan.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
