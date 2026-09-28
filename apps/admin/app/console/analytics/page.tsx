/**
 * /console/analytics — System-wide analytics
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { SectionHeader, StatCard, Card, Badge } from "@/components/ui";
import { formatCount, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "System Analytics" };

export default async function AnalyticsPage() {
  const auth = await requireRfAdminSession();
  if (!auth.ok) redirect("/login");

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [
    totalOrgs,
    totalUsers,
    totalMessages,
    messages30d,
    aiMessages30d,
    humanMessages30d,
    totalConvs,
    convs30d,
    escalations30d,
    resolvedConvs30d,
    subscriptionBreakdown,
    topOrgsByVolume,
    dailyVolume,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.customerMessage.count(),
    prisma.customerMessage.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.customerMessage.count({ where: { sender: "AI", createdAt: { gte: thirtyDaysAgo } } }),
    prisma.customerMessage.count({ where: { sender: "EMPLOYEE", createdAt: { gte: thirtyDaysAgo } } }),
    prisma.customerConversation.count(),
    prisma.customerConversation.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.customerConversation.count({
      where: { status: "HUMAN_ESCALATION", createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.customerConversation.count({
      where: { status: "RESOLVED", updatedAt: { gte: thirtyDaysAgo } },
    }),
    prisma.subscription.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.customerMessage.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS count
      FROM customer_messages
      WHERE "createdAt" >= ${fourteenDaysAgo}
      GROUP BY 1 ORDER BY 1 ASC
    `,
  ]);

  const subMap = Object.fromEntries(subscriptionBreakdown.map((r) => [r.status, r._count.id]));
  const daily = dailyVolume.map((r) => ({
    day: r.day.toISOString().split("T")[0] ?? "",
    count: Number(r.count),
  }));
  const maxDaily = Math.max(1, ...daily.map((d) => d.count));

  // Resolve org names for top orgs
  const topOrgIds = topOrgsByVolume.map((r) => r.organizationId);
  const topOrgNames = await prisma.organization.findMany({
    where: { id: { in: topOrgIds } },
    select: { id: true, name: true },
  });
  const orgNameMap = new Map(topOrgNames.map((o) => [o.id, o.name]));

  const aiRate = aiMessages30d + humanMessages30d === 0
    ? null
    : aiMessages30d / (aiMessages30d + humanMessages30d);
  const escalationRate = convs30d === 0 ? null : escalations30d / convs30d;

  type SubStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "PAUSED" | "CANCELED";
  const subTones: Record<SubStatus, "success" | "info" | "warning" | "muted"> = {
    ACTIVE: "success", TRIALING: "info", PAST_DUE: "warning", PAUSED: "warning", CANCELED: "muted",
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      <SectionHeader
        eyebrow="/ analytics"
        title="System Analytics"
        description="Aggregate metrics across all client organizations — last 30 days unless noted."
      />

      {/* Top-line stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Client orgs" value={totalOrgs} sub="registered" />
        <StatCard label="Total users" value={formatCount(totalUsers)} />
        <StatCard label="Messages (30d)" value={formatCount(messages30d)} accent />
        <StatCard label="Conversations (30d)" value={formatCount(convs30d)} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="AI resolution rate"
          value={aiRate !== null ? pct(aiMessages30d, aiMessages30d + humanMessages30d) : "—"}
          sub={`${formatCount(aiMessages30d)} AI / ${formatCount(humanMessages30d)} human`}
          accent
        />
        <StatCard
          label="Escalation rate"
          value={escalationRate !== null ? pct(escalations30d, convs30d) : "—"}
          sub={`${escalations30d} escalated / ${convs30d} total`}
        />
        <StatCard
          label="Resolved (30d)"
          value={formatCount(resolvedConvs30d)}
          sub="conversations resolved"
        />
        <StatCard label="All-time messages" value={formatCount(totalMessages)} />
      </div>

      {/* Daily volume chart (pure CSS bar chart) */}
      <Card>
        <h2 className="mb-4 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Message volume — last 14 days
        </h2>
        {daily.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No messages in the last 14 days.</p>
        ) : (
          <div className="flex items-end gap-1.5 h-28" aria-label="Daily message volume bar chart">
            {daily.map((d) => {
              const heightPct = Math.round((d.count / maxDaily) * 100);
              return (
                <div
                  key={d.day}
                  className="flex flex-1 flex-col items-center gap-1 min-w-0"
                  title={`${d.day}: ${d.count} messages`}
                >
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${heightPct}%`,
                      minHeight: d.count > 0 ? "3px" : 0,
                      background: "var(--accent)",
                      opacity: 0.7,
                    }}
                  />
                  <span
                    className="font-mono text-[8px] rotate-45 origin-left truncate"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {d.day?.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* Subscription breakdown */}
        <Card>
          <h2 className="mb-3 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Subscriptions by status
          </h2>
          <div className="flex flex-col gap-2">
            {Object.entries(subMap).length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No subscriptions.</p>
            ) : (
              Object.entries(subMap).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <Badge tone={subTones[status as SubStatus] ?? "default"}>{status}</Badge>
                  <span className="font-mono text-sm text-[var(--text-primary)]">{count}</span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Top orgs by volume */}
        <Card>
          <h2 className="mb-3 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Top orgs by message volume (30d)
          </h2>
          <div className="flex flex-col gap-2">
            {topOrgsByVolume.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No data yet.</p>
            ) : (
              topOrgsByVolume.map((r) => (
                <div key={r.organizationId} className="flex items-center justify-between">
                  <span className="truncate text-sm text-[var(--text-secondary)]">
                    {orgNameMap.get(r.organizationId) ?? r.organizationId}
                  </span>
                  <span
                    className="ml-4 shrink-0 font-mono text-sm text-[var(--text-primary)]"
                  >
                    {formatCount(r._count.id)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* All-time totals */}
      <Card>
        <h2 className="mb-3 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
          All-time totals
        </h2>
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Organizations" value={totalOrgs} />
          <StatCard label="Users" value={formatCount(totalUsers)} />
          <StatCard label="Messages" value={formatCount(totalMessages)} />
          <StatCard label="Conversations" value={formatCount(totalConvs)} />
        </div>
      </Card>
    </div>
  );
}
