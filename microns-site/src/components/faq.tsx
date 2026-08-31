import { faqs } from "@/content/copy";

/**
 * Native details/summary: keyboard-operable without any script, and the open
 * state is real interaction feedback rather than decoration.
 */
export function Faq() {
  return (
    <div className="border-t border-mist">
      {faqs.map((f) => (
        <details key={f.q} className="group border-b border-mist">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 text-[1.125rem] leading-snug [&::-webkit-details-marker]:hidden">
            <span>{f.q}</span>
            <span
              aria-hidden="true"
              className="relative mt-2.5 h-px w-4 shrink-0 bg-ink before:absolute before:left-1/2 before:top-1/2 before:h-4 before:w-px before:-translate-x-1/2 before:-translate-y-1/2 before:bg-ink before:transition-transform before:duration-200 group-open:before:scale-y-0"
            />
          </summary>
          <p className="max-w-[62ch] pb-7 pr-8 text-slate">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
