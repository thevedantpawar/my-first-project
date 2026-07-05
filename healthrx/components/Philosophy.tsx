import { philosophy } from "@/lib/site";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

export function Philosophy() {
  return (
    <section
      id="philosophy"
      className="relative overflow-hidden border-y border-white/5 bg-ink-soft py-24 sm:py-32"
    >
      <div className="absolute inset-0 bg-[radial-gradient(50%_50%_at_15%_50%,rgba(183,255,0,0.08),transparent_60%)]" />
      <div className="shell relative grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <SectionHeading
            eyebrow="Our philosophy"
            title={
              <>
                Fitness, dosed like <span className="text-lime">medicine</span>
              </>
            }
            intro="We borrow the discipline of clinical care and apply it to your training. Assess. Prescribe. Progress. No fads, no guesswork — just evidence."
          />

          <Reveal delay={0.2}>
            <div className="mt-8 glass inline-flex items-center gap-4 p-4">
              <span className="animate-heartbeat text-lime">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
                  <path d="M12 20s-7-4.35-9.5-8.5C1 8.5 2.5 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.5 0 5 3.5 3.5 6.5C19 15.65 12 20 12 20Z" />
                </svg>
              </span>
              <div>
                <div className="font-display text-lg font-semibold">
                  Evidence over ego
                </div>
                <div className="text-sm text-white/50">
                  Programs re-tested every 2 weeks
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Steps */}
        <div className="relative">
          <div className="absolute left-8 top-0 hidden h-full w-px bg-gradient-to-b from-lime/50 via-white/10 to-transparent sm:block" />
          <div className="space-y-5">
            {philosophy.map((p, i) => (
              <Reveal key={p.step} delay={i * 0.1}>
                <div className="glass relative flex gap-6 p-6 transition-transform duration-300 hover:translate-x-1">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-lime/30 bg-lime/10 font-display text-2xl font-bold text-lime">
                    {p.step}
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-semibold">
                      {p.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/55">
                      {p.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
