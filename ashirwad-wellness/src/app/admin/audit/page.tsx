import type { Metadata } from "next";
import { Lock } from "lucide-react";

import { getAuditLog } from "@/lib/admin";
import { AuditAction } from "@/generated/prisma/enums";
import type { RawSearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const action = typeof params.action === "string" && params.action in AuditAction
    ? params.action
    : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const { entries, total } = await getAuditLog({
    action,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  return (
    <div>
      <div className="flex items-start gap-2">
        <Lock aria-hidden="true" className="mt-0.5 size-4 text-pine-700" />
        <div>
          <h2 className="text-base text-ink">Audit log</h2>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-ink-500">
            Read-only, and not merely in this interface: the database rejects
            UPDATE, DELETE and TRUNCATE on this table. There is no administrator
            action that can remove an entry.
          </p>
        </div>
      </div>

      <form className="mt-4 flex flex-wrap gap-2">
        <select name="action" defaultValue={action ?? ""} className="rounded-[var(--radius-control)] border border-ink-100 bg-paper-raised px-2.5 py-2 text-sm">
          <option value="">All actions</option>
          {Object.values(AuditAction).map((a) => (
            <option key={a} value={a}>{a.toLowerCase().replace(/_/g, " ")}</option>
          ))}
        </select>
        <button type="submit" className="rounded-[var(--radius-control)] border border-pine-700 px-3 py-2 text-sm text-pine-700">
          Filter
        </button>
      </form>

      <p className="mt-3 text-xs text-ink-500">
        <span className="identifier">{total}</span> entries
      </p>

      <div className="mt-2 overflow-x-auto rounded-[var(--radius-card)] border border-ink-100">
        <table className="w-full min-w-[900px] border-collapse text-xs">
          <thead>
            <tr className="bg-pine-700 text-left text-paper">
              {["When", "Actor", "Action", "Entity", "IP", "Detail"].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-ink-100 bg-paper-raised align-top">
                <td className="identifier px-3 py-2 whitespace-nowrap text-ink-500">
                  {e.createdAt.toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2 text-ink-700">
                  {e.actor?.name ?? e.actor?.email ?? "system"}
                  <span className="block text-[0.625rem] text-ink-300">{e.actorRole ?? "—"}</span>
                </td>
                <td className="px-3 py-2 text-ink">{e.action.toLowerCase().replace(/_/g, " ")}</td>
                <td className="px-3 py-2 text-ink-700">
                  {e.entityType}
                  <span className="identifier block text-[0.625rem] text-ink-300">{e.entityId ?? "—"}</span>
                </td>
                <td className="identifier px-3 py-2 text-ink-500">{e.ipAddress ?? "—"}</td>
                <td className="px-3 py-2">
                  {e.metadata ? (
                    <pre className="identifier max-w-md whitespace-pre-wrap break-words text-[0.625rem] text-ink-500">
                      {JSON.stringify(e.metadata)}
                    </pre>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <nav className="mt-4 flex gap-2" aria-label="Audit log pagination">
          {page > 1 && (
            <a href={`/admin/audit?page=${page - 1}${action ? `&action=${action}` : ""}`} className="rounded-[var(--radius-control)] border border-ink-100 px-3 py-1.5 text-sm">
              Previous
            </a>
          )}
          {page * PAGE_SIZE < total && (
            <a href={`/admin/audit?page=${page + 1}${action ? `&action=${action}` : ""}`} className="rounded-[var(--radius-control)] border border-ink-100 px-3 py-1.5 text-sm">
              Next
            </a>
          )}
        </nav>
      )}
    </div>
  );
}
