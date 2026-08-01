import Link from "next/link";
import { ShoppingCart, User } from "lucide-react";

import { SearchBox } from "./search-box";
import { getCategoryTree } from "@/lib/catalogue";

export async function SiteHeader() {
  const categories = await getCategoryTree();

  return (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-paper-raised/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 py-3">
          <Link href="/" className="shrink-0">
            <span className="font-display text-lg leading-none text-pine-700 sm:text-xl">
              Ashirwad
            </span>
            <span className="block text-[0.625rem] uppercase tracking-[0.18em] text-ink-300">
              Wellness
            </span>
          </Link>

          <div className="hidden min-w-0 flex-1 md:block">
            <SearchBox />
          </div>

          <nav className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link
              href="/account"
              className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-2 text-sm text-ink-700 hover:bg-pine-50"
            >
              <User aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Account</span>
            </Link>
            <Link
              href="/cart"
              className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-pine-700 px-3 py-2 text-sm font-medium text-paper hover:bg-pine-900"
            >
              <ShoppingCart aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Cart</span>
            </Link>
          </nav>
        </div>

        {/* Search moves below the logo on narrow screens rather than shrinking. */}
        <div className="pb-3 md:hidden">
          <SearchBox />
        </div>

        <nav
          aria-label="Product categories"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
        >
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-ink-700 hover:bg-pine-50 hover:text-pine-700"
            >
              {c.name}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
