import { NextResponse } from "next/server";
import { z } from "zod";

import { suggest } from "@/lib/search";

/**
 * Autocomplete endpoint.
 *
 * Read-only over public catalogue data, so there is no auth requirement — but
 * the query is still validated and length-capped, because an unbounded string
 * reaching a trigram query is a cheap way to make Postgres work hard.
 * Rate limiting arrives in Phase 6.
 */

const querySchema = z.object({
  q: z.string().trim().min(2).max(64),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ q: searchParams.get("q") ?? "" });

  if (!parsed.success) {
    return NextResponse.json({ suggestions: [] });
  }

  const suggestions = await suggest(parsed.data.q);

  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
