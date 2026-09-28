/**
 * /console/audit-log — RF Admin audit log
 *
 * Server-rendered, cursor-paginated. Shows AdminAuditLog rows only —
 * never client-org AuditLog rows.
 * Filters: adminId, orgId, action prefix, succeeded flag.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import {
  SectionHeader,
  Badge,
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  Empty,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit Log" };

interface AuditRow {
  id: string;
  adminId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  organizationId: string | null;
  targetEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  succeeded: boolean;
  metadataJson: string | null;
  createdAt: Date;
}

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) redirect("/login");

  const sp = await searchParams;
  const filterAdmin = typeof sp.adminId === "string" ? sp.adminId.trim() : undefined;
  const filterOrg = typeof sp.orgId === "string" ? sp.orgId.trim() : undefined;
  const filterAction = typeof sp.action === "string" ? sp.action.trim() : undefined;
  const filterSucceeded =
    sp.succeeded === "true" ? true : sp.succeeded === "false" ? false : undefined;
  const cursor =
    typeof sp.cursor === "string" && sp.cursor ? new Date(sp.cursor) : undefined;

  const entries: AuditRow[] = await prisma.adminAuditLog.findMany({
    where: {
      ...(filterAdmin ? { adminId: filterAdmin } : {}),
      ...(filterOrg ? { organizationId: filterOrg } : {}),
      ...(filterAction ? { action: { startsWith: filterAction } } : {}),
      ...(filterSucceeded !== undefined ? { succeeded: filterSucceeded } : {}),
      ...(cursor ? { createdAt: { lt: cursor } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      adminId: true,
      action: true,
      entityType: true,
      entityId: true,
      organizationId: true,
      targetEmail: true,
      ipAddress: true,
      userAgent: true,
      succeeded: true,
      metadataJson: true,
      createdAt: true,
    },
  });

  const hasMore = entries.length > PAGE_SIZE;
  const rows = hasMore ? entries.slice(0, PAGE_SIZE) : entries;
  const nextCursor = hasMore
    ? rows[rows.length - 1]?.createdAt.toISOString()
    : null;

  // Resolve admin names for display
  const adminIds = [...new Set(rows.map((r) => r.adminId).filter(Boolean))] as string[];
  const admins = await prisma.rfAdminUser.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, name: true, email: true },
  });
  const adminMap = new Map(admins.map((a) => [a.id, a]));

  // Build next-page URL preserving current filters
  function buildPageUrl(c: string | null) {
    const p = new URLSearchParams();
    if (filterAdmin) p.set("adminId", filterAdmin);
    if (filterOrg) p.set("orgId", filterOrg);
    if (filterAction) p.set("action", filterAction);
    if (filterSucceeded !== undefined) p.set("succeeded", String(filterSucceeded));
    if (c) p.set("cursor", c);
    const qs = p.toString();
    return `/console/audit-log${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <SectionHeader
        eyebrow="/ audit-log"
        title="RF Admin Audit Log"
        description="Every privileged action taken by RF staff. Append-only — rows survive organization deletion."
      />

      {/* Filter form */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        {(
          [
            { name: "adminId", label: "Admin ID", value: filterAdmin ?? "" },
            { name: "orgId", label: "Org ID", value: filterOrg ?? "" },
            { name: "action", label: "Action prefix", value: filterAction ?? "" },
          ] as const
        ).map(({ name, label, value }) => (
          <div key={name} className="flex flex-col gap-1">
            <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              {label}
            </label>
            <input
              name={name}
              defaultValue={value}
              className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] w-44"
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            Succeeded
          </label>
          <select
            name="succeeded"
            defaultValue={filterSucceeded === undefined ? "" : String(filterSucceeded)}
            className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--accent)]/50 transition-colors"
        >
          Filter
        </button>
        <a
          href="/console/audit-log"
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors self-end pb-1"
        >
          Clear
        </a>
      </form>

      <Table>
        <Thead>
          <tr>
            <Th>Timestamp</Th>
            <Th>Admin</Th>
            <Th>Action</Th>
            <Th>Entity</Th>
            <Th>Organization</Th>
            <Th>IP</Th>
            <Th>Result</Th>
          </tr>
        </Thead>
        <Tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7}>
                <Empty message="No audit log entries match the current filters." />
              </td>
            </tr>
          ) : (
            rows.map((entry) => {
              const admin = entry.adminId ? adminMap.get(entry.adminId) : null;
              return (
                <Tr key={entry.id}>
                  <Td mono>
                    <time dateTime={entry.createdAt.toISOString()}>
                      {formatDateTime(entry.createdAt)}
                    </time>
                  </Td>
                  <Td>
                    {admin ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-[var(--text-primary)]">
                          {admin.name}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--text-muted)]">
                          {admin.email}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {entry.adminId ?? "—"}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <code
                      className="rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 font-mono text-[10px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {entry.action}
                    </code>
                  </Td>
                  <Td mono>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {entry.entityType}
                    </span>
                    {entry.entityId && (
                      <span
                        className="block truncate font-mono text-[10px] max-w-[120px]"
                        style={{ color: "var(--text-muted)" }}
                        title={entry.entityId}
                      >
                        {entry.entityId}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {entry.organizationId ? (
                      <Link
                        href={`/console/organizations/${entry.organizationId}`}
                        className="font-mono text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                      >
                        {entry.organizationId}
                      </Link>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </Td>
                  <Td mono>{entry.ipAddress ?? "—"}</Td>
                  <Td>
                    <Badge tone={entry.succeeded ? "success" : "danger"}>
                      {entry.succeeded ? "ok" : "failed"}
                    </Badge>
                  </Td>
                </Tr>
              );
            })
          )}
        </Tbody>
      </Table>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>
          Showing {rows.length} entr{rows.length !== 1 ? "ies" : "y"}
          {cursor ? " (filtered by cursor)" : ""}
        </span>
        <div className="flex items-center gap-3">
          {cursor && (
            <a
              href={buildPageUrl(null)}
              className="hover:text-[var(--text-secondary)] transition-colors"
            >
              ← Newest
            </a>
          )}
          {hasMore && nextCursor && (
            <a
              href={buildPageUrl(nextCursor)}
              className="hover:text-[var(--text-secondary)] transition-colors"
            >
              Older →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
