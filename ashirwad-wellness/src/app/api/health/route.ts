import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { checkProductionReadiness, isReady } from "@/lib/preflight";

export const dynamic = "force-dynamic";

/**
 * Health check for a load balancer or orchestrator.
 *
 * Deliberately says nothing about *why* it is unhealthy beyond a count. This
 * endpoint is unauthenticated, and the readiness findings name environment
 * variables and infrastructure — useful to an operator, and equally useful to
 * someone deciding where to push. `npm run check:env` is where the detail
 * lives, and that runs on a terminal, not on the public internet.
 *
 * A deployment that is up but not compliant reports unhealthy on purpose: it
 * should not be receiving customer traffic, and a load balancer is the right
 * place to enforce that.
 */
export async function GET() {
  const findings = checkProductionReadiness(process.env);
  const ready = isReady(findings);

  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }

  const healthy = database && (ready || process.env.NODE_ENV !== "production");

  return NextResponse.json(
    {
      status: healthy ? "ok" : "unhealthy",
      database,
      configuration: ready ? "ready" : "incomplete",
      blockers: findings.filter((f) => f.level === "blocker").length,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
