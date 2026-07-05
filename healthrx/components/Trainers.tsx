"use client";

import { useRef } from "react";
import { trainers } from "@/lib/site";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

export function Trainers() {
  return (
    <section id="trainers" className="relative py-24 sm:py-32">
      <div className="shell">
        <SectionHeading
          eyebrow="The team"
          title={
            <>
              Coaches who <span className="text-lime">know your body</span>
            </>
          }
          intro="Certified specialists in strength, rehab, women's programming and clinical nutrition."
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {trainers.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.07}>
              <TiltCard>
                <div className="glass h-full overflow-hidden p-6">
                  <div className="relative mb-5 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent">
                    <span className="font-display text-6xl font-bold text-white/10">
                      {t.initials}
                    </span>
                    <span className="absolute bottom-3 left-3 rounded-full bg-lime px-3 py-1 text-[11px] font-semibold text-ink">
                      {t.focus}
                    </span>
                  </div>
                  <h3 className="font-display text-lg font-semibold">
                    {t.name}
                  </h3>
                  <p className="text-sm text-lime/90">{t.role}</p>
                  <p className="mt-2 text-xs text-white/45">{t.creds}</p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Pointer-driven 3D tilt on hover. Falls back to static on touch / reduced motion. */
function TiltCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${py * -8}deg) rotateY(${
      px * 8
    }deg) translateY(-4px)`;
  };

  const reset = () => {
    const el = ref.current;
    if (el) el.style.transform = "";
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className="h-full transition-transform duration-200 ease-out [transform-style:preserve-3d] will-change-transform"
    >
      {children}
    </div>
  );
}
