import "server-only";
import { headers } from "next/headers";
import { db } from "./db";
import type { AuditAction, Role } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Immutable audit trail.
 *
 * The audit_logs table is append-only at the database level: UPDATE, DELETE
 * and TRUNCATE all raise. There is deliberately no update or delete helper in
 * this module, and adding one would not work.
 *
 * Every dispensing-relevant action writes here. Actor, action, entity,
 * timestamp and IP are the minimum; metadata carries the before/after detail
 * that makes an entry worth reading a year later.
 */

type AuditInput = {
  actorId?: string | null;
  actorRole?: Role | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Resolves the client IP behind the proxy chain. Trusts the leftmost
 * x-forwarded-for entry, which is correct behind a single trusted proxy;
 * revisit if a CDN is put in front.
 */
async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ip =
      forwarded?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null;
    return { ip, userAgent: h.get("user-agent") };
  } catch {
    // Outside a request scope — seed scripts, background jobs.
    return { ip: null, userAgent: null };
  }
}

/**
 * Writes an audit entry.
 *
 * Never throws. An audit write failing must not roll back the action it was
 * recording — losing the order is worse than losing the log line — but it is
 * logged loudly so the gap is visible.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const { ip, userAgent } = await requestContext();
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata,
        ipAddress: ip,
        userAgent,
      },
    });
  } catch (error) {
    console.error("[audit] FAILED TO WRITE AUDIT ENTRY", {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error,
    });
  }
}

/**
 * Audit write that participates in the caller's transaction.
 *
 * Use this when the log entry must not survive a rolled-back action — an H1
 * register entry and its audit row should either both exist or neither should.
 */
export async function auditInTransaction(
  tx: Prisma.TransactionClient,
  input: AuditInput & { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
