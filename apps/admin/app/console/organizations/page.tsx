/**
 * /console/organizations — Client organization list
 *
 * Server-rendered. Shows all client orgs with health indicators.
 * Search is a query-param driven server filter (no JS required).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { requireRfAdminSession } from "@/lib/session";
import { redirect } from "next/navigation";
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
import { formatDate, formatCount } from "@/lib/utils";
import { Building2, ChevronRight, Search } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Organizations",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgRow {
  id: string;
  name: string;
  plan: string;
  createdAt: string;
  userCount: number;
  messages30d: number;
  activeConversations: number;
  lastActivityAt: string | null;
  subscription: {
    status: string;
    currentPeriodEnd: string;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    plan: { name: string; slug: string } | null;
  } | null;
}

type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "PAUSED"
  | "CANCELED";

function subBadge(status?: string | null) {
  const map: Record<SubscriptionStatus, "success" | "warning" | "danger" | "info" | "muted"> = {
    ACTIVE: "success",
    TRIALING: "info",
    PAST_DUE: "warning",
    PAUSED: "warning",
    CANCELED: "muted",
  };
  const tone = map[(status ?? "") as SubscriptionStatus] ?? "default";
  return <Badge tone={tone}>{status ?? "no plan"}</Badge>;
}

function activityBadge(lastAt: string | null) {
  if (!lastAt) return <Badge tone="muted">no activity</Badge>;
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000);
  if (days <= 1) return <Badge tone="success">today</Badge>;
  if (days <= 7) return <Badge tone="success">{days}d ago</Badge>;
  if (days <= 30) return <Badge tone="warning">{days}d ago</Badge>;
  return <Badge tone="danger">{days}d ago</Badge>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) redirect("/login");

  const params = await searchParams;
  const search =
    typeof params.search === "string" ? params.search.trim() : "";

  const url = new URL(
    `/api/admin/organizations${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    "http://localhost",
  );
  // Call the route handler directly (same process — avoids a network hop)
  const { organizations } = await fetch(url.toString(), {
    headers: { cookie: "" }, // server-side, cookie auth handled separately
  })
    .then((r) => r.json() as Promise<{ organizations: OrgRow[] }>)
    .catch(() => ({ organizations: [] as OrgRow[] }));

  // Fetch directly from DB since we're already server-side
  const { prisma } = await import("@rf-intelligence/db");
  const orgsRaw = await prisma.organization.findMany({
    where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      plan: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { users: true } },
      subscriptions: {
        select: {
          status: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          cancelAtPeriodEnd: true,
          plan: { select: { name: true, slug: true } },
        },
        take: 1,
      },
    },
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const orgIds = orgsRaw.map((o) => o.id);

  const [msgCounts, convCounts, lastActivities] = await Promise.all([
    prisma.customerMessage.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgIds }, createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    }),
    prisma.customerConversation.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgIds }, status: { notIn: ["RESOLVED", "CLOSED"] } },
      _count: { id: true },
    }),
    prisma.customerMessage.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgIds } },
      _max: { createdAt: true },
    }),
  ]);

  const msgMap = new Map(msgCounts.map((r) => [r.organizationId, r._count.id]));
  const convMap = new Map(convCounts.map((r) => [r.organizationId, r._count.id]));
  const lastMap = new Map(lastActivities.map((r) => [r.organizationId, r._max.createdAt]));

  const rows: OrgRow[] = orgsRaw.map((org) => ({
    id: org.id,
    name: org.name,
    plan: org.plan,
    createdAt: org.createdAt.toISOString(),
    userCount: org._count.users,
    messages30d: msgMap.get(org.id) ?? 0,
    activeConversations: convMap.get(org.id) ?? 0,
    lastActivityAt: lastMap.get(org.id)?.toISOString() ?? null,
    subscription: org.subscriptions[0]
      ? {
          ...org.subscriptions[0],
          currentPeriodEnd: org.subscriptions[0].currentPeriodEnd.toISOString(),
          trialEndsAt: org.subscriptions[0].trialEndsAt?.toISOString() ?? null,
        }
      : null,
  }));

  void organizations; // API route also available for client-side use

  return (
    <div className="flex flex-col gap-6 p-8">
      <SectionHeader
        eyebrow="/ organizations"
        title="Client Organizations"
        description={`${rows.length} organization${rows.length !== 1 ? "s" : ""} registered`}
      >
        {/* Search form — server-side, no JS needed */}
        <form method="get" className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
              aria-hidden="true"
            />
            <input
              name="search"
              defaultValue={search}
              placeholder="Search organizations…"
              className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] w-60"
            />
          </div>
          <button
            type="submit"
            className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:border-[var(--accent)]/50 transition-colors"
          >
            Search
          </button>
          {search && (
            <a
              href="/console/organizations"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Clear
            </a>
          )}
        </form>
      </SectionHeader>

      <Table>
        <Thead>
          <tr>
            <Th>Organization</Th>
            <Th>Subscription</Th>
            <Th>Users</Th>
            <Th>Messages (30d)</Th>
            <Th>Active convs</Th>
            <Th>Last activity</Th>
            <Th>Created</Th>
            <Th />
          </tr>
        </Thead>
        <Tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8}>
                <Empty
                  message={
                    search
                      ? `No organizations matching "${search}"`
                      : "No organizations yet"
                  }
                />
              </td>
            </tr>
          ) : (
            rows.map((org) => (
              <Tr key={org.id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <div
                      className="flex size-7 shrink-0 items-center justify-center rounded"
                      style={{ background: "var(--surface-elevated)" }}
                    >
                      <Building2
                        className="size-3.5"
                        style={{ color: "var(--accent)" }}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span
                        className="text-sm font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {org.name}
                      </span>
                      <span
                        className="font-mono text-[10px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {org.id}
                      </span>
                    </div>
                  </div>
                </Td>
                <Td>{subBadge(org.subscription?.status)}</Td>
                <Td mono>{org.userCount}</Td>
                <Td mono>{formatCount(org.messages30d)}</Td>
                <Td mono>{org.activeConversations}</Td>
                <Td>{activityBadge(org.lastActivityAt)}</Td>
                <Td mono>{formatDate(org.createdAt)}</Td>
                <Td>
                  <Link
                    href={`/console/organizations/${org.id}`}
                    className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                    aria-label={`View ${org.name}`}
                  >
                    View
                    <ChevronRight className="size-3" aria-hidden="true" />
                  </Link>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
