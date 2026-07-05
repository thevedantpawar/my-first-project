"use client";

import { useCallback, useRef, useState } from "react";
import { transformations } from "@/lib/site";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

export function Transformations() {
  return (
    <section id="results" className="relative py-24 sm:py-32">
      <div className="shell">
        <SectionHeading
          eyebrow="Real results"
          title={
            <>
              Transformations, <span className="text-lime">not before-photos</span>
            </>
          }
          intro="Drag the slider to see the change. Every result is the product of a measured, coached program."
        />

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {transformations.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.08}>
              <div className="glass overflow-hidden p-4">
                <BeforeAfter before={t.before} after={t.after} />
                <div className="flex items-center justify-between px-1 pt-4">
                  <span className="font-display text-lg font-semibold">
                    {t.name}
                  </span>
                  <span className="rounded-full bg-lime/15 px-3 py-1 text-xs font-medium text-lime">
                    {t.result}
                  </span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = ((clientX - r.left) / r.width) * 100;
    setPos(Math.max(0, Math.min(100, pct)));
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative aspect-[4/5] w-full cursor-ew-resize select-none overflow-hidden rounded-2xl"
      onMouseDown={(e) => {
        dragging.current = true;
        update(e.clientX);
      }}
      onMouseMove={(e) => dragging.current && update(e.clientX)}
      onMouseUp={() => (dragging.current = false)}
      onMouseLeave={() => (dragging.current = false)}
      onTouchStart={(e) => update(e.touches[0].clientX)}
      onTouchMove={(e) => update(e.touches[0].clientX)}
      role="slider"
      aria-label="Before and after comparison"
      aria-valuenow={Math.round(pos)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 4));
        if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 4));
      }}
    >
      {/* After (base) */}
      <div
        className="absolute inset-0 flex items-end justify-start p-4"
        style={{
          background: `linear-gradient(160deg, ${after}, #0b0b0b)`,
        }}
      >
        <span className="rounded-full bg-lime px-3 py-1 text-[11px] font-semibold text-ink">
          After
        </span>
      </div>

      {/* Before (clipped) */}
      <div
        className="absolute inset-0 flex items-end justify-end p-4"
        style={{
          background: `linear-gradient(160deg, ${before}, #0b0b0b)`,
          clipPath: `inset(0 ${100 - pos}% 0 0)`,
        }}
      >
        <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur">
          Before
        </span>
      </div>

      {/* Handle */}
      <div
        className="absolute inset-y-0 z-10 w-0.5 bg-lime"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-lime bg-ink text-lime shadow-glow">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M8 6 4 12l4 6M16 6l4 6-4 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
