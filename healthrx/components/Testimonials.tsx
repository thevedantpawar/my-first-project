import { testimonials } from "@/lib/site";
import { SectionHeading } from "./SectionHeading";

export function Testimonials() {
  // Duplicate the list so the marquee can loop seamlessly.
  const loop = [...testimonials, ...testimonials];

  return (
    <section className="relative overflow-hidden border-y border-white/5 bg-ink-soft py-24 sm:py-32">
      <div className="shell">
        <SectionHeading
          eyebrow="Member stories"
          title={
            <>
              Trusted by <span className="text-lime">Nashik</span>
            </>
          }
          intro="Beginners, professionals and transformation clients — here's what membership feels like."
        />
      </div>

      <div className="group relative mt-14">
        {/* edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-soft to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-soft to-transparent" />

        <div className="flex w-max animate-marquee gap-5 group-hover:[animation-play-state:paused]">
          {loop.map((t, i) => (
            <figure
              key={i}
              className="glass w-[340px] shrink-0 p-7 sm:w-[400px]"
            >
              <div className="text-lime" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
                  <path d="M7 7h4v6c0 2.2-1.5 3.7-3.8 4L7 15.6c1-.2 1.6-.8 1.6-1.6H7V7Zm8 0h4v6c0 2.2-1.5 3.7-3.8 4L15 15.6c1-.2 1.6-.8 1.6-1.6H15V7Z" />
                </svg>
              </div>
              <blockquote className="mt-4 text-sm leading-relaxed text-white/75">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-lime/15 font-display text-sm font-bold text-lime">
                  {t.name.charAt(0)}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{t.name}</span>
                  <span className="block text-xs text-white/45">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
