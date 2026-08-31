import Link from "next/link";
import { routes } from "@/content/site";
import { BookButton } from "./ui";

export function SiteHeader() {
  return (
    <header className="border-b border-mist">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 py-4 md:px-10 md:py-5 lg:px-16">
        <Link
          href="/"
          className="text-[1.375rem] leading-none tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-display)" }}
          aria-label="Microns, home"
        >
          Microns
        </Link>

        <nav aria-label="Main" className="flex items-center gap-7">
          <ul className="hidden items-center gap-7 sm:flex">
            {routes.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href}
                  className="text-[1rem] text-slate transition-colors hover:text-ink"
                >
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
          <BookButton
            label="Book a call"
            className="min-h-[44px] px-5 text-[0.9375rem]"
          />
        </nav>
      </div>
    </header>
  );
}
