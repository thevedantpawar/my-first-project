"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Mobile only. Appears after the first scroll so it never covers the hero CTA.
 */
export function MobileCtaBar() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-mist bg-porcelain p-3 transition-transform duration-300 md:hidden ${
        shown ? "translate-y-0" : "translate-y-full"
      }`}
      aria-hidden={!shown}
    >
      <Link
        href="/book"
        data-cta="book"
        tabIndex={shown ? 0 : -1}
        className="plausible-event-name=Book+call flex min-h-[52px] w-full items-center justify-center bg-micron px-6 text-[1.0625rem] leading-none text-porcelain"
      >
        Book a 20-minute call
      </Link>
    </div>
  );
}
