"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Pill, Tag, Loader2 } from "lucide-react";

import type { Suggestion } from "@/lib/search";

/**
 * Catalogue search with autocomplete.
 *
 * Suggestions are keyboard-navigable and announced to assistive technology via
 * the combobox pattern — a customer searching for a medicine should not need a
 * mouse. Requests are debounced and superseded: a slow response for an earlier
 * keystroke must never overwrite a newer one.
 */
export function SearchBox({
  initialQuery = "",
  autoFocus = false,
}: {
  initialQuery?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  // Monotonic request id — a stale response is discarded rather than rendered.
  const requestId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const id = ++requestId.current;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (id === requestId.current) {
          setSuggestions(data.suggestions ?? []);
          setActiveIndex(-1);
          setLoading(false);
        }
      } catch {
        if (id === requestId.current) setLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function hrefFor(s: Suggestion): string {
    switch (s.kind) {
      case "product":
        return `/product/${s.slug}`;
      case "salt":
        return `/salt/${s.slug}`;
      case "brand":
        return `/search?q=${encodeURIComponent(s.label)}`;
    }
  }

  function go(s: Suggestion) {
    setOpen(false);
    router.push(hrefFor(s));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      go(suggestions[activeIndex]);
      return;
    }
    if (query.trim().length >= 2) {
      setOpen(false);
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const listboxId = "search-suggestions";

  return (
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={onSubmit} role="search">
        <label htmlFor="catalogue-search" className="sr-only">
          Search for medicines, brands or salts
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300"
          />
          <input
            id="catalogue-search"
            type="search"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search medicines, brands or salts…"
            className="w-full rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised py-2.5 pl-9 pr-9 text-sm text-ink placeholder:text-ink-300"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
            }
          />
          {loading && (
            <Loader2
              aria-hidden="true"
              className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-300"
            />
          )}
        </div>
      </form>

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute z-50 mt-1 max-h-96 w-full overflow-auto rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised py-1 shadow-[var(--shadow-raised)]"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.kind}-${s.slug}`}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
            >
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => go(s)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                  i === activeIndex ? "bg-pine-50" : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-7 shrink-0 place-items-center rounded-full ${
                    s.kind === "salt"
                      ? "bg-living-100 text-living-600"
                      : s.kind === "brand"
                        ? "bg-turmeric-100 text-turmeric-600"
                        : "bg-pine-100 text-pine-700"
                  }`}
                >
                  {s.kind === "salt" ? (
                    <Pill className="size-3.5" />
                  ) : s.kind === "brand" ? (
                    <Tag className="size-3.5" />
                  ) : (
                    <Search className="size-3.5" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-ink">{s.label}</span>
                    {s.kind === "product" && s.requiresPrescription && (
                      <span className="shrink-0 text-[0.625rem] font-bold text-rx-500">
                        ℞
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-ink-300">
                    {s.kind === "salt" && "Salt · "}
                    {s.kind === "brand" && "Brand · "}
                    {s.sublabel}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
