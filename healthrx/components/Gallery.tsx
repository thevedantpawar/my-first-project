"use client";

import { useEffect, useState } from "react";
import { gallery } from "@/lib/site";
import { SectionHeading } from "./SectionHeading";
import { Reveal } from "./Reveal";

const spanClasses: Record<string, string> = {
  wide: "sm:col-span-2",
  tall: "sm:row-span-2",
  normal: "",
};

export function Gallery() {
  const [active, setActive] = useState<number | null>(null);

  return (
    <section
      id="gallery"
      className="relative overflow-hidden border-y border-white/5 bg-ink-soft py-24 sm:py-32"
    >
      <div className="absolute inset-0 bg-[radial-gradient(45%_45%_at_80%_20%,rgba(255,242,0,0.07),transparent_60%)]" />
      <div className="shell relative">
        <SectionHeading
          eyebrow="The space"
          title={
            <>
              Step inside <span className="text-lime">HealthRx</span>
            </>
          }
          intro="Concrete, calm and clinical — a premium environment designed to make training feel like therapy. Explore the club before you visit."
        />

        <div className="mt-14 grid auto-rows-[220px] grid-cols-1 gap-4 sm:grid-cols-3">
          {gallery.map((item, i) => (
            <Reveal
              key={item.src}
              delay={i * 0.06}
              className={`${spanClasses[item.span]} min-h-0`}
            >
              <button
                onClick={() => setActive(i)}
                className={`group relative h-full w-full overflow-hidden rounded-3xl border border-white/10 text-left`}
              >
                <GalleryImg src={item.src} title={item.title} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-5">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-lime">
                      {item.tag}
                    </div>
                    <div className="font-display text-lg font-semibold text-white">
                      {item.title}
                    </div>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  </span>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      </div>

      {active !== null && (
        <Lightbox
          items={gallery}
          index={active}
          onClose={() => setActive(null)}
          onNav={(n) =>
            setActive((c) =>
              c === null ? c : (c + n + gallery.length) % gallery.length
            )
          }
        />
      )}
    </section>
  );
}

/** Real photo when present in /public/gallery, branded placeholder otherwise. */
function GalleryImg({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.07] to-transparent">
        <span className="font-display text-4xl font-bold text-white/10">
          Health<span className="text-lime/40">Rx</span>
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`HealthRx — ${title}`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
    />
  );
}

function Lightbox({
  items,
  index,
  onClose,
  onNav,
}: {
  items: typeof gallery;
  index: number;
  onClose: () => void;
  onNav: (n: number) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNav(1);
      if (e.key === "ArrowLeft") onNav(-1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, onNav]);

  const item = items[index];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 text-white transition-colors hover:border-lime hover:text-lime"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <NavBtn side="left" onClick={(e) => { e.stopPropagation(); onNav(-1); }} />
      <NavBtn side="right" onClick={(e) => { e.stopPropagation(); onNav(1); }} />

      <figure
        className="max-h-[85vh] w-full max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-hidden rounded-3xl border border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.src}
            alt={`HealthRx — ${item.title}`}
            className="max-h-[75vh] w-full object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <figcaption className="mt-4 text-center">
          <span className="text-xs uppercase tracking-wide text-lime">
            {item.tag}
          </span>
          <div className="font-display text-xl font-semibold text-white">
            {item.title}
          </div>
        </figcaption>
      </figure>
    </div>
  );
}

function NavBtn({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      className={`absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 text-white transition-colors hover:border-lime hover:text-lime ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={side === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}
