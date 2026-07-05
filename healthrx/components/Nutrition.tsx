import { CheckIcon, ArrowIcon } from "./Icons";
import { Reveal } from "./Reveal";

const points = [
  "Personalised macro targets from your calculators",
  "Weekly meal frameworks built for Nashik kitchens",
  "Vegetarian, non-veg & Jain-friendly options",
  "Supplement guidance — only what's evidence-backed",
  "Habit coaching that survives real life & travel",
];

export function Nutrition() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="shell">
        <div className="glass relative overflow-hidden p-8 sm:p-12">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-lime/10 blur-[100px]" />
          <div className="relative grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <Reveal>
                <span className="eyebrow">Nutrition coaching</span>
              </Reveal>
              <Reveal delay={0.08}>
                <h2 className="section-heading mt-5">
                  Food is the other half of the{" "}
                  <span className="text-lime">prescription</span>
                </h2>
              </Reveal>
              <Reveal delay={0.16}>
                <p className="mt-4 text-lg leading-relaxed text-white/60">
                  You can&apos;t out-train a poor diet. Our registered nutrition
                  coaching turns your numbers into simple, sustainable eating —
                  tuned to your body, culture and schedule.
                </p>
              </Reveal>
              <Reveal delay={0.24}>
                <a href="#contact" className="btn-primary mt-8">
                  Talk to a nutrition coach
                  <ArrowIcon className="h-4 w-4" />
                </a>
              </Reveal>
            </div>

            <ul className="space-y-3">
              {points.map((p, i) => (
                <Reveal as="li" key={p} delay={i * 0.06}>
                  <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lime text-ink">
                      <CheckIcon className="h-4 w-4" />
                    </span>
                    <span className="text-sm text-white/75">{p}</span>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
