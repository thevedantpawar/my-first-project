import { services } from "@/lib/site";
import { Icon, ArrowIcon, type IconName } from "./Icons";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

export function Services() {
  return (
    <section id="services" className="relative py-24 sm:py-32">
      <div className="shell">
        <SectionHeading
          eyebrow="What we do"
          title={
            <>
              A full clinic of <span className="text-lime">fitness services</span>
            </>
          }
          intro="Everything you need to get healthier — assessed, coached and progressed under one roof."
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s, i) => (
            <Reveal as="article" key={s.title} delay={i * 0.06}>
              <div className="group glass relative h-full overflow-hidden p-7 transition-all duration-300 hover:-translate-y-1 hover:border-lime/40">
                <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-lime/10 blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-lime/25 bg-lime/10 text-lime">
                  <Icon name={s.icon as IconName} className="h-6 w-6" />
                </div>
                <h3 className="mt-6 font-display text-xl font-semibold">
                  {s.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/55">
                  {s.body}
                </p>
                <div className="mt-6 flex items-center gap-2 text-sm font-medium text-lime opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  Learn more
                  <ArrowIcon className="h-4 w-4" />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
