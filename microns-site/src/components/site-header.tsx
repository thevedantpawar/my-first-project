import Link from "next/link";
import { routes } from "@/content/site";
import { BookButton } from "./ui";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <header className="border-b border-mist">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 py-4 md:px-10 md:py-5 lg:px-16">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center"
          aria-label="Microns, home"
        >
          <Logo />
        </Link>

        <nav aria-label="Main" className="flex items-center gap-7">
          <ul className="flex items-center gap-6 sm:gap-7">
            {routes.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href}
                  className="inline-flex min-h-[44px] items-center text-[1rem] text-slate transition-colors hover:text-ink"
                >
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
          {/* Mobile keeps the nav links and hands the CTA to the hero and the
              sticky bottom bar, so the header never crowds a 390px viewport. */}
          <BookButton
            label="Book a call"
            className="hidden min-h-[44px] px-5 text-[0.9375rem] sm:inline-flex"
          />
        </nav>
      </div>
    </header>
  );
}
