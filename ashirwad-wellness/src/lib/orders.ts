import "server-only";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Customer-facing order number: AW-2026-000042.
 *
 * Drawn from a Postgres sequence rather than a row count. Two concurrent
 * checkouts counting rows would mint the same number; a sequence never hands
 * the same value to two transactions. Rolled-back transactions leave gaps,
 * which is the correct trade — a gap is harmless, a collision is not, and the
 * order number is a unique column.
 */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('order_number_seq') AS nextval
  `;

  const year = new Date().getFullYear();
  return `AW-${year}-${String(nextval).padStart(6, "0")}`;
}
