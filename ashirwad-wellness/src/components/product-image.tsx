"use client";

import { useCallback, useState } from "react";

/**
 * Product imagery with a deterministic fallback.
 *
 * The catalogue ships without photography, and a broken image icon on a
 * pharmacy listing reads as a broken shop. This renders a stable, tinted
 * monogram derived from the slug instead — same product, same tile, every
 * time — and swaps to the real photograph the moment one exists at the path.
 */

const TINTS = [
  { bg: "var(--color-pine-50)", fg: "var(--color-pine-700)" },
  { bg: "var(--color-living-50)", fg: "var(--color-living-600)" },
  { bg: "var(--color-turmeric-50)", fg: "var(--color-turmeric-600)" },
  { bg: "var(--color-paper-sunk)", fg: "var(--color-ink-700)" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Up to two initials from the brand or product name. */
function monogram(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ProductImage({
  src,
  name,
  slug,
  label,
  className = "",
}: {
  src?: string | null;
  name: string;
  slug: string;
  /** Dosage form, shown under the monogram. */
  label?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const tint = TINTS[hash(slug) % TINTS.length];

  // onError alone is not enough. Server-rendered <img> tags start loading while
  // the HTML is still parsing, so a 404 fires its error event *before* React
  // hydrates and attaches the handler — leaving broken-image alt text on screen
  // forever. This ref runs at attach time and catches an image that has already
  // finished loading with no intrinsic width, i.e. one that already failed.
  const detectAlreadyFailed = useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setFailed(true);
  }, []);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={detectAlreadyFailed}
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`flex h-full w-full flex-col items-center justify-center gap-1 ${className}`}
      style={{ backgroundColor: tint.bg }}
    >
      <span
        className="font-display text-2xl leading-none"
        style={{ color: tint.fg }}
      >
        {monogram(name)}
      </span>
      {/* No opacity on the label. Each tint pair clears 4.5:1 at full strength
          and none of them does at 70%, and this is 9px text — the size that
          needs the ratio most. Reach for a lighter token, not a lighter alpha. */}
      {label && (
        <span
          className="identifier text-[0.5625rem] uppercase tracking-wider"
          style={{ color: tint.fg }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
