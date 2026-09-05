import { RX_GATE_COPY, H1_CITATION } from "@/lib/schedule";
import { ScheduleType } from "@/generated/prisma/enums";

/**
 * The Rx Gate — the one visual element this design spends boldness on.
 *
 * These components are the *only* sanctioned way to signal that a product
 * requires a prescription. They render identically on the catalogue card, the
 * product page, the cart line and the checkout line, because a returning
 * customer should recognise a prescription item without reading it.
 *
 * Do not fork these for a specific surface. If a surface needs a different
 * size, change the padding around them — never the marker, the colour, or the
 * wording.
 *
 * --rx is reserved for these components. It appears nowhere else in the
 * application, which is what makes the colour itself informative.
 */

type Size = "sm" | "md";

/** The ℞ chip. Always present wherever a prescription item appears. */
export function RxBadge({
  variant = "solid",
  className = "",
}: {
  variant?: "solid" | "quiet";
  className?: string;
}) {
  return (
    <span
      className={`rx-badge ${variant === "quiet" ? "rx-badge--quiet" : ""} ${className}`}
    >
      <span aria-hidden="true">℞</span>
      <span>Prescription</span>
      <span className="sr-only">
        — this item requires a prescription verified by a pharmacist
      </span>
    </span>
  );
}

/**
 * The bordered container. Wraps a cart line, a checkout line, or a product
 * card body. The 3px left rule in --rx is the recognition cue.
 */
export function RxGate({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`rx-gate ${className}`}>{children}</div>;
}

/** The sentence. One string, everywhere — see RX_GATE_COPY. */
export function RxNotice({
  scheduleType,
  tone = "long",
  size = "md",
}: {
  scheduleType: ScheduleType;
  tone?: "short" | "long" | "cart" | "blocked";
  size?: Size;
}) {
  const copy = {
    short: RX_GATE_COPY.short,
    long: RX_GATE_COPY.long,
    cart: RX_GATE_COPY.cartNotice,
    blocked: RX_GATE_COPY.blocked,
  }[tone];

  const isH1 = scheduleType === ScheduleType.SCHEDULE_H1;

  return (
    <div className={size === "sm" ? "text-xs" : "text-sm"}>
      <p className="text-rx-700">{copy}</p>
      {isH1 && (
        <p className="identifier mt-1 text-[0.6875rem] text-ink-500">{H1_CITATION}</p>
      )}
    </div>
  );
}

/**
 * Convenience wrapper for a full prescription-item block: badge, border and
 * notice together. This is what most surfaces should reach for.
 */
export function RxGateBlock({
  scheduleType,
  tone = "long",
  children,
  className = "",
}: {
  scheduleType: ScheduleType;
  tone?: "short" | "long" | "cart" | "blocked";
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <RxGate className={`rounded-r-[var(--radius-control)] p-3 ${className}`}>
      <div className="flex flex-wrap items-start gap-2">
        <RxBadge />
        <div className="min-w-0 flex-1">
          <RxNotice scheduleType={scheduleType} tone={tone} />
          {children}
        </div>
      </div>
    </RxGate>
  );
}
