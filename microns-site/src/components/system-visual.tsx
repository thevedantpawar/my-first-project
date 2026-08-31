import type { SystemVisual as Visual } from "@/content/copy";

/**
 * What the client on the other end actually receives. Shown instead of stock
 * photography: it is the product, it is specific, and it is honest — every
 * instance is captioned as an illustration.
 */
export function SystemVisual({
  visual,
  className = "",
}: {
  visual: Visual;
  className?: string;
}) {
  return (
    <figure className={`m-0 ${className}`}>
      <div className="border border-mist bg-white/55 p-5 sm:p-7">
        <div className="flex items-baseline justify-between gap-4 border-b border-mist pb-3">
          <span className="text-meta">{visual.channel}</span>
          <span className="tnum text-meta text-slate">{visual.stamp}</span>
        </div>

        <div className="space-y-3 pt-5">
          {visual.thread.map((m, i) => (
            <p
              key={i}
              className={
                m.from === "out"
                  ? "max-w-[34ch] bg-micron px-4 py-3 text-[0.9375rem] leading-normal text-porcelain"
                  : "ml-auto max-w-[26ch] border border-mist bg-porcelain px-4 py-3 text-right text-[0.9375rem] leading-normal"
              }
            >
              {m.text}
            </p>
          ))}
        </div>

        {visual.outcome ? (
          <p className="mt-5 border-t border-mist pt-4 text-meta text-slate">
            {visual.outcome}
          </p>
        ) : null}
      </div>

      <figcaption className="mt-3 text-meta text-slate">
        An illustration of the message as the client receives it. Wording is
        yours, and you approve it before anything goes live.
      </figcaption>
    </figure>
  );
}
