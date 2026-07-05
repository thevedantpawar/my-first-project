import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

export function SectionHeading({
  eyebrow,
  title,
  intro,
  center = false,
}: {
  eyebrow: string;
  title: ReactNode;
  intro?: string;
  center?: boolean;
}) {
  return (
    <div className={`max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      <Reveal>
        <span className="eyebrow">{eyebrow}</span>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="section-heading mt-5">{title}</h2>
      </Reveal>
      {intro && (
        <Reveal delay={0.16}>
          <p className="mt-4 text-lg leading-relaxed text-white/60">{intro}</p>
        </Reveal>
      )}
    </div>
  );
}
