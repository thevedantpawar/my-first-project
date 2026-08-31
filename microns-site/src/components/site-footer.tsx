import Link from "next/link";
import { site } from "@/content/site";

const columns = [
  {
    heading: "Pages",
    links: [
      { href: "/", label: "Home" },
      { href: "/systems", label: "Systems" },
      { href: "/about", label: "About" },
    ],
  },
  {
    heading: "Start",
    links: [
      { href: "/book", label: "Book a 20-minute call" },
      { href: "/audit", label: "Request a revenue leak audit" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="on-ink bg-ink text-porcelain">
      <div className="mx-auto w-full max-w-[1400px] px-6 pb-28 pt-16 md:px-10 md:pb-16 md:pt-20 lg:px-16">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <p
              className="text-[1.5rem] leading-none"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Microns
            </p>
            <p className="mt-4 max-w-[34ch] text-[1rem] text-[color:var(--color-slate-inverse)]">
              {site.tagline}
            </p>
          </div>

          {columns.map((col) => (
            <nav
              key={col.heading}
              aria-label={col.heading}
              className="md:col-span-3"
            >
              <p className="text-meta text-[color:var(--color-slate-inverse)]">
                {col.heading}
              </p>
              <ul className="mt-1">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="inline-flex min-h-[44px] items-center text-[1rem] underline decoration-transparent underline-offset-[6px] transition-colors hover:decoration-porcelain"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-2 border-t border-white/12 pt-6 text-meta text-[color:var(--color-slate-inverse)] md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} Microns. A one-person automation studio.
          </p>
          <p>
            <a
              href={`mailto:${site.founder.email}`}
              className="inline-flex min-h-[44px] items-center underline underline-offset-[6px] hover:text-porcelain"
            >
              {site.founder.email}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
