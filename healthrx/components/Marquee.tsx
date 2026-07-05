const words = [
  "Assess",
  "Prescribe",
  "Progress",
  "Strength",
  "Nutrition",
  "Rehab",
  "Transformation",
  "Longevity",
];

export function Marquee() {
  const loop = [...words, ...words];
  return (
    <div className="relative overflow-hidden border-y border-white/10 bg-lime py-4">
      <div className="flex w-max animate-marquee items-center gap-8">
        {loop.map((w, i) => (
          <div key={i} className="flex items-center gap-8">
            <span className="font-display text-lg font-bold uppercase tracking-wide text-ink">
              {w}
            </span>
            <span className="text-ink/40">✦</span>
          </div>
        ))}
      </div>
    </div>
  );
}
