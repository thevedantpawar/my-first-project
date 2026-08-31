import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "outline" | "inverse";

const base =
  "inline-flex min-h-[52px] items-center justify-center px-7 py-3.5 " +
  "text-[1.0625rem] leading-none transition-colors duration-150 " +
  "active:translate-y-px";

const variants: Record<Variant, string> = {
  primary: "bg-micron text-porcelain hover:bg-[#1636b4]",
  outline:
    "border border-ink text-ink hover:bg-ink hover:text-porcelain",
  inverse:
    "bg-porcelain text-ink hover:bg-mist",
};

/** The primary conversion action. Tagged for analytics. */
export function BookButton({
  variant = "primary",
  className = "",
  label = "Book a 20-minute call",
}: {
  variant?: Variant;
  className?: string;
  label?: string;
}) {
  return (
    <Link
      href="/book"
      data-cta="book"
      className={`plausible-event-name=Book+call ${base} ${variants[variant]} ${className}`}
    >
      {label}
    </Link>
  );
}

export function TextLink({
  children,
  className = "",
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={
        "inline-flex min-h-[44px] items-center " +
        "underline decoration-mist decoration-1 underline-offset-[6px] " +
        "transition-colors hover:decoration-micron hover:text-micron " +
        className
      }
    >
      {children}
    </Link>
  );
}

/** A section's numeric marking. The instrument metaphor, used structurally. */
export function SectionIndex({
  n,
  label,
}: {
  n: string;
  label: string;
}) {
  return (
    <div className="flex items-baseline gap-3 md:block">
      <span className="tnum text-meta text-micron">{n}</span>
      <span className="block text-meta text-slate md:mt-2">{label}</span>
    </div>
  );
}

/**
 * The page's spine: a numbered marking column on the left, content in an
 * asymmetric measure on the right. No cards anywhere.
 */
export function Section({
  index,
  label,
  children,
  className = "",
  id,
}: {
  index?: string;
  label?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`border-t border-mist ${className}`}>
      <div className="mx-auto w-full max-w-[1400px] px-6 md:px-10 lg:px-16">
        <div className="grid gap-8 py-20 md:grid-cols-12 md:gap-10 md:py-28 lg:py-36">
          {index && label ? (
            <div className="md:col-span-3 lg:col-span-2">
              <SectionIndex n={index} label={label} />
            </div>
          ) : null}
          <div
            className={
              index ? "md:col-span-9 lg:col-span-9 lg:col-start-4" : "md:col-span-12"
            }
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Measure({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`max-w-[62ch] ${className}`}>{children}</div>;
}
