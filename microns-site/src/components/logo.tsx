/**
 * The Microns lockup: the micron scale, one graduation in the accent blue,
 * beside the wordmark. The mark is inline SVG so it inherits currentColor and
 * works on both the porcelain and the ink surface; the wordmark stays live text
 * so it renders crisply and is readable by screen readers and search engines.
 */
export function Logo({
  className = "",
  size = 26,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        <rect x="8" y="6" width="2" height="28" fill="currentColor" />
        <rect x="10" y="8" width="16" height="2" fill="currentColor" />
        <rect x="10" y="14" width="9" height="2" fill="currentColor" />
        <rect
          x="10"
          y="20"
          width="23"
          height="2"
          fill="var(--color-micron)"
          className="[.on-ink_&]:fill-[color:#5C7BEA]"
        />
        <rect x="10" y="26" width="9" height="2" fill="currentColor" />
        <rect x="10" y="32" width="16" height="2" fill="currentColor" />
      </svg>
      <span
        className="text-[1.375rem] leading-none tracking-[-0.01em]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Microns
      </span>
    </span>
  );
}
