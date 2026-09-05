import Link from "next/link";

/**
 * Server-rendered pagination. Real links, so the catalogue is crawlable and
 * middle-click works — a client-side page switcher would break both.
 */
export function CataloguePagination({
  page,
  totalPages,
  baseHref,
  searchParams,
}: {
  page: number;
  totalPages: number;
  baseHref: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (totalPages <= 1) return null;

  function hrefFor(target: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "page" || value === undefined) continue;
      if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
      else params.set(key, value);
    }
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  }

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1,
  );

  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-1">
      {page > 1 && (
        <Link
          href={hrefFor(page - 1)}
          rel="prev"
          className="rounded-[var(--radius-control)] border border-ink-100 px-3 py-1.5 text-sm text-ink-700 hover:bg-pine-50"
        >
          Previous
        </Link>
      )}

      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && pages[i - 1] !== p - 1 && (
            <span aria-hidden="true" className="px-1 text-ink-300">
              …
            </span>
          )}
          <Link
            href={hrefFor(p)}
            aria-current={p === page ? "page" : undefined}
            className={`identifier rounded-[var(--radius-control)] px-3 py-1.5 text-sm ${
              p === page
                ? "bg-pine-700 text-paper"
                : "border border-ink-100 text-ink-700 hover:bg-pine-50"
            }`}
          >
            {p}
          </Link>
        </span>
      ))}

      {page < totalPages && (
        <Link
          href={hrefFor(page + 1)}
          rel="next"
          className="rounded-[var(--radius-control)] border border-ink-100 px-3 py-1.5 text-sm text-ink-700 hover:bg-pine-50"
        >
          Next
        </Link>
      )}
    </nav>
  );
}
