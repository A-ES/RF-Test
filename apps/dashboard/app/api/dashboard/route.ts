/**
 * GET /api/dashboard
 *
 * Single round-trip that returns every dataset the Dashboard Overview page
 * needs. All queries are scoped by organizationId from the verified session.
 *
 * Resilience: Uses Promise.allSettled so if individual queries fail or time out,
 * the parts that succeeded are returned along with section-level error flags,
 * rather than failing with a blanket 500 error.
 * Short in-memory server cache (15-30s) tagged per organization.
 */

import { getSession } from "@/app/lib/session";
import { prisma, Prisma } from "@/app/lib/db";
import type { DashboardData, MetricCard, DashboardAlert, RecentConversation } from "@/app/types/dashboard";
import type { Project }  from "@/app/types/project";
import type { Insight, InsightActionStatus, ChartDataPoint } from "@/app/types/insight";
import { withTiming } from "@/app/lib/timing";
import { PROJECT_SELECT, serializeProject, type ProjectRow } from "@/app/api/projects/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Organization Dashboard Server Cache (20s TTL) ───────────────────────────

interface CachedDashboard {
  data: DashboardData;
  expiresAt: number;
}
const globalForDashboard = globalThis as unknown as {
  __dashboardCache?: Map<string, CachedDashboard>;
};
const dashboardCache = (globalForDashboard.__dashboardCache ??= new Map<string, CachedDashboard>());
const DASHBOARD_CACHE_TTL_MS = 30_000;

export function invalidateDashboardCache(orgId: string) {
  dashboardCache.delete(orgId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const diff  = Date.now() - date.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return "Just now";
  if (mins  < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  if (days  === 1) return "Yesterday";
  return `${days} days ago`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function parseChartData(json: string): ChartDataPoint[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as ChartDataPoint[]) : [];
  } catch { return []; }
}


// ─── Metric card computation & Counts ─────────────────────────────────────────

interface CountsRaw {
  active_projects: bigint | number;
  prev_projects: bigint | number;
  open_convs: bigint | number;
  prev_convs: bigint | number;
  ins_30d: bigint | number;
  ins_60d: bigint | number;
  unread_insights: bigint | number;
  members: bigint | number;
  prev_members: bigint | number;
  total_actioned: bigint | number;
  accepted_actioned: bigint | number;
  prev_total: bigint | number;
  prev_accepted: bigint | number;
}

async function fetchAggregatedCounts(orgId: string, now: Date): Promise<{
  counts: CountsRaw;
  cards: MetricCard[];
}> {
  const thirtyDaysAgo  = new Date(now.getTime() - 30 * 86_400_000);
  const sixtyDaysAgo   = new Date(now.getTime() - 60 * 86_400_000);
  const quarterAgo     = new Date(now.getTime() - 90 * 86_400_000);
  const prevQuarterAgo = new Date(now.getTime() - 180 * 86_400_000);
  const yesterday      = new Date(now.getTime() - 86_400_000);

  // Single SQL query replacing 13 count round-trips
  const rows = await prisma.$queryRaw<CountsRaw[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "projects" WHERE "organizationId" = ${orgId} AND status != 'COMPLETED') as active_projects,
      (SELECT COUNT(*) FROM "projects" WHERE "organizationId" = ${orgId} AND status != 'COMPLETED' AND "createdAt" < ${thirtyDaysAgo}) as prev_projects,
      (SELECT COUNT(*) FROM "conversations" WHERE "organizationId" = ${orgId} AND unread = true) as open_convs,
      (SELECT COUNT(*) FROM "conversations" WHERE "organizationId" = ${orgId} AND unread = true AND "createdAt" < ${yesterday}) as prev_convs,
      (SELECT COUNT(*) FROM "insights" WHERE "organizationId" = ${orgId} AND "createdAt" >= ${thirtyDaysAgo}) as ins_30d,
      (SELECT COUNT(*) FROM "insights" WHERE "organizationId" = ${orgId} AND "createdAt" >= ${sixtyDaysAgo} AND "createdAt" < ${thirtyDaysAgo}) as ins_60d,
      (SELECT COUNT(*) FROM "insights" WHERE "organizationId" = ${orgId} AND read = false) as unread_insights,
      (SELECT COUNT(*) FROM "users" WHERE "organizationId" = ${orgId}) as members,
      (SELECT COUNT(*) FROM "users" WHERE "organizationId" = ${orgId} AND "createdAt" < ${thirtyDaysAgo}) as prev_members,
      (SELECT COUNT(*) FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "performedAt" >= ${quarterAgo}) as total_actioned,
      (SELECT COUNT(*) FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "actionStatus" = 'ACCEPTED' AND "performedAt" >= ${quarterAgo}) as accepted_actioned,
      (SELECT COUNT(*) FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "performedAt" >= ${prevQuarterAgo} AND "performedAt" < ${quarterAgo}) as prev_total,
      (SELECT COUNT(*) FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "actionStatus" = 'ACCEPTED' AND "performedAt" >= ${prevQuarterAgo} AND "performedAt" < ${quarterAgo}) as prev_accepted
  `);

  const r = rows[0] || {} as Partial<CountsRaw>;
  const toNum = (val: bigint | number | undefined | null) => (val !== undefined && val !== null ? Number(val) : 0);

  const activeProjectCount = toNum(r.active_projects);
  const prevProjectCount   = toNum(r.prev_projects);
  const openConvCount      = toNum(r.open_convs);
  const prevConvCount      = toNum(r.prev_convs);
  const insightCount30d    = toNum(r.ins_30d);
  const insightCount60d    = toNum(r.ins_60d);
  const memberCount        = toNum(r.members);
  const prevMemberCount    = toNum(r.prev_members);
  const totalActioned      = toNum(r.total_actioned);
  const acceptedActioned   = toNum(r.accepted_actioned);
  const prevTotal          = toNum(r.prev_total);
  const prevAccepted       = toNum(r.prev_accepted);

  const renewalRate = totalActioned > 0 ? Math.round((acceptedActioned / totalActioned) * 100) : 0;
  const prevRenewalRate = prevTotal > 0 ? Math.round((prevAccepted / prevTotal) * 100) : 0;
  const renewalDelta = renewalRate - prevRenewalRate;

  const projectDelta = activeProjectCount - prevProjectCount;
  const convDelta    = openConvCount      - prevConvCount;
  const insightDelta = insightCount30d    - insightCount60d;
  const memberDelta  = memberCount        - prevMemberCount;

  const cards: MetricCard[] = [
    {
      id: "mc_projects",
      label: "Active Projects",
      value: String(activeProjectCount),
      rawValue: activeProjectCount,
      delta: signed(projectDelta),
      deltaValue: projectDelta,
      trend: projectDelta > 0 ? "up" : projectDelta < 0 ? "down" : "flat",
      chipColor: "blue",
      iconKey: "folder-kanban",
      period: "vs last month",
    },
    {
      id: "mc_conversations",
      label: "Open Conversations",
      value: String(openConvCount),
      rawValue: openConvCount,
      delta: signed(convDelta),
      deltaValue: convDelta,
      trend: convDelta > 0 ? "up" : convDelta < 0 ? "down" : "flat",
      chipColor: "violet",
      iconKey: "messages-square",
      period: "since yesterday",
    },
    {
      id: "mc_insights",
      label: "AI Insights",
      value: String(insightCount30d),
      rawValue: insightCount30d,
      delta: signed(insightDelta),
      deltaValue: insightDelta,
      trend: insightDelta > 0 ? "up" : insightDelta < 0 ? "down" : "flat",
      chipColor: "red",
      iconKey: "sparkles",
      period: "last 30 days",
    },
    {
      id: "mc_renewal",
      label: "Acceptance Rate",
      value: `${renewalRate}%`,
      rawValue: renewalRate,
      delta: signed(renewalDelta) + "%",
      deltaValue: renewalDelta,
      trend: renewalDelta > 0 ? "up" : renewalDelta < 0 ? "down" : "flat",
      chipColor: "green",
      iconKey: "trending-up",
      period: "this quarter",
    },
    {
      id: "mc_team",
      label: "Team Members",
      value: String(memberCount),
      rawValue: memberCount,
      delta: memberDelta === 0 ? "0" : signed(memberDelta),
      deltaValue: memberDelta,
      trend: memberDelta > 0 ? "up" : memberDelta < 0 ? "down" : "flat",
      chipColor: "amber",
      iconKey: "users",
      period: "in this workspace",
    },
  ];

  return { counts: r as CountsRaw, cards };
}

// ─── Alerts Formatter ─────────────────────────────────────────────────────────

function formatAlerts(
  atRiskProjects: Array<{ id: string; name: string; status: string; accountName: string; dueDate: Date }>,
  criticalInsights: Array<{ id: string; title: string; body: string; accountName: string | null }>,
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  for (const p of atRiskProjects) {
    const daysLeft = Math.ceil((p.dueDate.getTime() - Date.now()) / 86_400_000);
    const duePart  = daysLeft <= 0
      ? "overdue"
      : daysLeft === 1 ? "due tomorrow"
      : `due in ${daysLeft} days`;

    alerts.push({
      id:          `alert_proj_${p.id}`,
      severity:    p.status === "BLOCKED" ? "critical" : "warning",
      title:       `${p.name} is ${p.status === "BLOCKED" ? "blocked" : "at risk"}`,
      body:        `${p.accountName} — ${duePart}.`,
      ctaLabel:    "Go to project",
      ctaHref:     "/projects",
      dismissible: true,
    });
  }

  for (const ins of criticalInsights) {
    alerts.push({
      id:          `alert_ins_${ins.id}`,
      severity:    "critical",
      title:       ins.title,
      body:        ins.accountName ? `${ins.accountName} — ${ins.body}` : ins.body,
      ctaLabel:    "View insight",
      ctaHref:     "/ai-insights",
      dismissible: true,
    });
  }

  return alerts;
}

// ─── Recent conversations ─────────────────────────────────────────────────────

type RawConvRow = {
  id: string;
  topic: string;
  contextLabel: string;
  rfLead: string;
  unread: boolean;
  updatedAt: Date;
  messages: Array<{
    content: string;
    createdAt: Date;
    sender: { name: string; avatarInitials: string };
  }>;
};

function formatRecentConversations(rows: RawConvRow[]): RecentConversation[] {
  return rows.map((row) => {
    const lastMsg    = row.messages[0] ?? null;
    const senderName = lastMsg?.sender.name ?? row.rfLead;
    const initials   = lastMsg?.sender.avatarInitials
      ?? row.rfLead
           .split(" ")
           .map((w) => w[0])
           .join("")
           .toUpperCase()
           .slice(0, 2);

    return {
      id:           row.id,
      senderName,
      senderInitials: initials,
      preview:      lastMsg?.content ?? row.topic,
      relativeTime: relativeTime(lastMsg?.createdAt ?? row.updatedAt),
      updatedAt:    row.updatedAt.toISOString(),
      unread:       row.unread,
      contextLabel: row.contextLabel,
    };
  });
}

// ─── Insights (top 5) ─────────────────────────────────────────────────────────

const INSIGHT_SELECT = {
  id: true,
  organizationId: true,
  type: true,
  severity: true,
  title: true,
  body: true,
  accountName: true,
  ctaHref: true,
  ctaLabel: true,
  read: true,
  whatHappened: true,
  whyDetected: true,
  chartTitle: true,
  chartType: true,
  chartDataJson: true,
  businessImpact: true,
  recommendedAction: true,
  createdAt: true,
  actions: {
    orderBy: { performedAt: "desc" as const },
    take:    1,
    select:  { actionStatus: true },
  },
} as const;

type RawInsight = NonNullable<
  Awaited<ReturnType<typeof prisma.insight.findFirst<{ select: typeof INSIGHT_SELECT }>>>
> & { actions: Array<{ actionStatus: string }> };

function serializeInsight(r: RawInsight): Insight {
  return {
    id:             r.id,
    organizationId: r.organizationId,
    type:           r.type as Insight["type"],
    severity:       r.severity as Insight["severity"],
    title:          r.title,
    body:           r.body,
    accountName:    r.accountName,
    ctaHref:        r.ctaHref,
    ctaLabel:       r.ctaLabel,
    read:           r.read,
    actionStatus:   r.actions[0]
      ? (r.actions[0].actionStatus as InsightActionStatus)
      : null,
    createdAt:      r.createdAt.toISOString(),
    detail: {
      whatHappened:      r.whatHappened,
      whyDetected:       r.whyDetected,
      chartTitle:        r.chartTitle,
      chartType:         r.chartType as Insight["detail"]["chartType"],
      chartData:         parseChartData(r.chartDataJson),
      businessImpact:    r.businessImpact,
      recommendedAction: r.recommendedAction,
    },
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  return withTiming("GET /api/dashboard", async () => {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = session.organizationId;
    const now   = new Date();

    // Check organization dashboard cache
    const cached = dashboardCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json(cached.data);
    }

    // Target: Max 5 DB round trips for the whole route.
    // 1: Aggregated metrics & counts (single SQL query)
    // 2: Recent Projects (top 10 to cover both overview list + at-risk alerts)
    // 3: Recent Insights (top 10 to cover both overview list + critical unread alerts)
    // 4: Recent Conversations (top 5 with last message)
    // (User greeting comes directly from verified session.name, zero DB round-trips)
    const [
      aggregatedCountsRes,
      projectsRes,
      insightsRes,
      conversationsRes,
    ] = await Promise.allSettled([
      fetchAggregatedCounts(orgId, now),
      prisma.project.findMany({
        where:   { organizationId: orgId },
        orderBy: { updatedAt: "desc" },
        take:    5,
        select:  PROJECT_SELECT,
      }),
      prisma.insight.findMany({
        where:   { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take:    5,
        select:  INSIGHT_SELECT,
      }),
      prisma.conversation.findMany({
        where:   { organizationId: orgId },
        orderBy: { updatedAt: "desc" },
        take:    5,
        select: {
          id:           true,
          topic:        true,
          contextLabel: true,
          rfLead:       true,
          unread:       true,
          updatedAt:    true,
          messages: {
            orderBy: { createdAt: "desc" },
            take:    1,
            select:  {
              content:   true,
              createdAt: true,
              sender: { select: { name: true, avatarInitials: true } },
            },
          },
        },
      }),
    ]);

    const countsData = aggregatedCountsRes.status === "fulfilled" ? aggregatedCountsRes.value : null;
    const metricCards = countsData?.cards ?? [];
    const unreadInsightCount = countsData?.counts ? Number(countsData.counts.unread_insights ?? 0) : 0;

    const rawProjects = projectsRes.status === "fulfilled" ? projectsRes.value : [];
    const rawInsights = insightsRes.status === "fulfilled" ? insightsRes.value : [];
    const rawConversations = conversationsRes.status === "fulfilled" ? conversationsRes.value : [];

    // Derive alerts in-memory from fetched lists without additional round-trips
    const atRiskProjects = rawProjects
      .filter((p) => p.status === "AT_RISK" || p.status === "BLOCKED")
      .slice(0, 3);
    const criticalInsights = rawInsights
      .filter((i) => i.severity === "CRITICAL" && !i.read && (!i.actions || i.actions.length === 0 || !["DISMISSED", "ACCEPTED"].includes(i.actions[0].actionStatus)))
      .slice(0, 3);
    const alerts = formatAlerts(atRiskProjects, criticalInsights);

    const countsFailed = aggregatedCountsRes.status === "rejected";
    const errors: Record<string, any> = {
      projects: projectsRes.status === "rejected",
      insights: insightsRes.status === "rejected",
      metrics: countsFailed,
      alerts: projectsRes.status === "rejected" || insightsRes.status === "rejected",
      conversations: conversationsRes.status === "rejected",
      counts: {
        projects: countsFailed,
        conversations: countsFailed,
        insights: countsFailed,
        renewal: countsFailed,
        team: countsFailed,
      },
    };

    const payload: DashboardData = {
      userName:           session.name || "there",
      metricCards,
      projects:           rawProjects.slice(0, 5).map((p) => serializeProject(p as ProjectRow)),
      insights:           rawInsights.slice(0, 5).map((r) => serializeInsight(r as RawInsight)),
      unreadInsightCount,
      alerts,
      recentConversations: formatRecentConversations(rawConversations as RawConvRow[]),
      errors,
    };

    // Cache successful parts
    dashboardCache.set(orgId, {
      data: payload,
      expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
    });

    return Response.json(payload);
  });
}
