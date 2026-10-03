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
import type {
  DashboardData,
  MetricCard,
  DashboardAlert,
  RecentConversation,
  ProjectStatusCounts,
  AIProcessStats,
  PendingActionStats,
  DashboardActivity,
  InsightHistoryPoint,
  ConversationHistoryPoint,
  TeamRoleCounts,
} from "@/app/types/dashboard";
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
  proj_on_track: bigint | number;
  proj_at_risk: bigint | number;
  proj_blocked: bigint | number;
  proj_completed: bigint | number;
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
  ai_docs_pending: bigint | number;
  ai_docs_processed: bigint | number;
  ai_docs_failed: bigint | number;
  ai_reports_processing: bigint | number;
  ai_reports_ready: bigint | number;
  ai_reports_failed: bigint | number;
  ai_convs_handling: bigint | number;
  pending_tasks: bigint | number;
  pending_escalations: bigint | number;
  users_admin: bigint | number;
  users_member: bigint | number;
  users_client_admin: bigint | number;
  users_client_employee: bigint | number;
  invites_pending: bigint | number;
}

async function fetchAggregatedCounts(orgId: string, now: Date): Promise<{
  counts: CountsRaw;
  cards: MetricCard[];
  projectStatusCounts: ProjectStatusCounts;
  aiProcessStats: AIProcessStats;
  pendingActionStats: PendingActionStats;
  teamRoles: TeamRoleCounts;
}> {
  const thirtyDaysAgo  = new Date(now.getTime() - 30 * 86_400_000);
  const sixtyDaysAgo   = new Date(now.getTime() - 60 * 86_400_000);
  const quarterAgo     = new Date(now.getTime() - 90 * 86_400_000);
  const prevQuarterAgo = new Date(now.getTime() - 180 * 86_400_000);
  const yesterday      = new Date(now.getTime() - 86_400_000);

  // Single SQL query with exact scoped metrics across all models
  const rows = await prisma.$queryRaw<CountsRaw[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "projects" WHERE "organizationId" = ${orgId} AND status != 'COMPLETED') as active_projects,
      (SELECT COUNT(*) FROM "projects" WHERE "organizationId" = ${orgId} AND status != 'COMPLETED' AND "createdAt" < ${thirtyDaysAgo}) as prev_projects,
      (SELECT COUNT(*) FROM "projects" WHERE "organizationId" = ${orgId} AND status = 'ON_TRACK') as proj_on_track,
      (SELECT COUNT(*) FROM "projects" WHERE "organizationId" = ${orgId} AND status = 'AT_RISK') as proj_at_risk,
      (SELECT COUNT(*) FROM "projects" WHERE "organizationId" = ${orgId} AND status = 'BLOCKED') as proj_blocked,
      (SELECT COUNT(*) FROM "projects" WHERE "organizationId" = ${orgId} AND status = 'COMPLETED') as proj_completed,
      (SELECT COUNT(*) FROM "conversations" WHERE "organizationId" = ${orgId} AND unread = true) as open_convs,
      (SELECT COUNT(*) FROM "conversations" WHERE "organizationId" = ${orgId} AND unread = true AND "createdAt" < ${yesterday}) as prev_convs,
      (SELECT COUNT(*) FROM "insights" WHERE "organizationId" = ${orgId} AND "createdAt" >= ${thirtyDaysAgo}) as ins_30d,
      (SELECT COUNT(*) FROM "insights" WHERE "organizationId" = ${orgId} AND "createdAt" >= ${sixtyDaysAgo} AND "createdAt" < ${thirtyDaysAgo}) as ins_60d,
      (SELECT COUNT(*) FROM "insights" WHERE "organizationId" = ${orgId} AND read = false AND id NOT IN (
        SELECT "insightId" FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "actionStatus"::text IN ('ACCEPTED', 'DISMISSED')
      )) as unread_insights,
      (SELECT COUNT(*) FROM "users" WHERE "organizationId" = ${orgId}) as members,
      (SELECT COUNT(*) FROM "users" WHERE "organizationId" = ${orgId} AND "createdAt" < ${thirtyDaysAgo}) as prev_members,
      (SELECT COUNT(*) FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "performedAt" >= ${quarterAgo}) as total_actioned,
      (SELECT COUNT(*) FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "actionStatus" = 'ACCEPTED' AND "performedAt" >= ${quarterAgo}) as accepted_actioned,
      (SELECT COUNT(*) FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "performedAt" >= ${prevQuarterAgo} AND "performedAt" < ${quarterAgo}) as prev_total,
      (SELECT COUNT(*) FROM "insight_actions" WHERE "organizationId" = ${orgId} AND "actionStatus" = 'ACCEPTED' AND "performedAt" >= ${prevQuarterAgo} AND "performedAt" < ${quarterAgo}) as prev_accepted,
      (SELECT COUNT(*) FROM "documents" WHERE "organizationId" = ${orgId} AND "processingStatus" = 'PENDING') as ai_docs_pending,
      (SELECT COUNT(*) FROM "documents" WHERE "organizationId" = ${orgId} AND "processingStatus" = 'PROCESSED') as ai_docs_processed,
      (SELECT COUNT(*) FROM "documents" WHERE "organizationId" = ${orgId} AND "processingStatus" = 'FAILED') as ai_docs_failed,
      (SELECT COUNT(*) FROM "reports" WHERE "organizationId" = ${orgId} AND "documentId" IS NULL AND "status" = 'PROCESSING') as ai_reports_processing,
      (SELECT COUNT(*) FROM "reports" WHERE "organizationId" = ${orgId} AND "documentId" IS NULL AND "status" = 'READY') as ai_reports_ready,
      (SELECT COUNT(*) FROM "reports" WHERE "organizationId" = ${orgId} AND "documentId" IS NULL AND "status" = 'FAILED') as ai_reports_failed,
      (SELECT COUNT(*) FROM "customer_conversations" WHERE "organizationId" = ${orgId} AND "status" = 'AI_HANDLING') as ai_convs_handling,
      (SELECT COUNT(*) FROM "tasks" WHERE "organizationId" = ${orgId} AND status::text != 'DONE') as pending_tasks,
      (SELECT COUNT(*) FROM "customer_conversations" WHERE "organizationId" = ${orgId} AND status::text IN ('WAITING_FOR_CLIENT', 'HUMAN_ESCALATION')) as pending_escalations,
      (SELECT COUNT(*) FROM "users" WHERE "organizationId" = ${orgId} AND role = 'ADMIN') as users_admin,
      (SELECT COUNT(*) FROM "users" WHERE "organizationId" = ${orgId} AND role = 'MEMBER') as users_member,
      (SELECT COUNT(*) FROM "users" WHERE "organizationId" = ${orgId} AND role = 'CLIENT_ADMIN') as users_client_admin,
      (SELECT COUNT(*) FROM "users" WHERE "organizationId" = ${orgId} AND role = 'CLIENT_EMPLOYEE') as users_client_employee,
      (SELECT COUNT(*) FROM "invitations" WHERE "organizationId" = ${orgId} AND status = 'PENDING') as invites_pending
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

  // Exact Project Status distribution
  const projectStatusCounts: ProjectStatusCounts = {
    onTrack:   toNum(r.proj_on_track),
    atRisk:    toNum(r.proj_at_risk),
    blocked:   toNum(r.proj_blocked),
    completed: toNum(r.proj_completed),
    total:     activeProjectCount,
  };

  // Real AI Tasks / Processes counts (no double-counting between documents and reports)
  const queuedDocs = toNum(r.ai_docs_pending);
  const processingReports = toNum(r.ai_reports_processing);
  const aiConvs = toNum(r.ai_convs_handling);
  const completedDocsAndReports = toNum(r.ai_docs_processed) + toNum(r.ai_reports_ready);
  const failedDocsAndReports = toNum(r.ai_docs_failed) + toNum(r.ai_reports_failed);
  const totalAiOperations = queuedDocs + processingReports + aiConvs + completedDocsAndReports + failedDocsAndReports;
  const activeAiPipeline = queuedDocs + processingReports + aiConvs;

  const aiProcessStats: AIProcessStats = {
    queued: queuedDocs,
    processing: processingReports,
    activeConversations: aiConvs,
    completed: completedDocsAndReports,
    failed: failedDocsAndReports,
    total: totalAiOperations,
    active: activeAiPipeline,
  };

  // Real Pending Actions (Actionable Tasks vs Review Signals)
  const openTasks = toNum(r.pending_tasks);
  const escalations = toNum(r.pending_escalations);
  const unreadInsights = toNum(r.unread_insights);
  const atRiskCount = projectStatusCounts.atRisk + projectStatusCounts.blocked;
  const actionableTasks = openTasks + escalations;
  const reviewSignals = unreadInsights + atRiskCount;
  const pendingTotal = actionableTasks + reviewSignals;

  const pendingActionStats: PendingActionStats = {
    actionableTasks,
    reviewSignals,
    openTasks,
    escalations,
    unreadInsights,
    atRiskProjects: atRiskCount,
    total: pendingTotal,
  };

  // Real Team Role distribution
  const teamRoles: TeamRoleCounts = {
    admin:   toNum(r.users_admin) + toNum(r.users_client_admin),
    member:  toNum(r.users_member) + toNum(r.users_client_employee),
    viewer:  0,
    pending: toNum(r.invites_pending),
    total:   memberCount,
  };

  // Acceptance Rate (0% when no actions recorded — NO 94% fallback)
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
      id: "mc_ai_processes",
      label: "AI Tasks / Processes",
      value: String(totalAiOperations),
      rawValue: totalAiOperations,
      delta: signed(queuedDocs + processingReports),
      deltaValue: queuedDocs + processingReports,
      trend: (queuedDocs + processingReports) > 0 ? "up" : "flat",
      chipColor: "violet",
      iconKey: "sparkles",
      period: `${queuedDocs + processingReports} in pipeline · ${aiConvs} AI chat`,
    },
    {
      id: "mc_insights",
      label: "Insights Generated",
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
      id: "mc_pending_actions",
      label: "Pending Actions",
      value: String(pendingTotal),
      rawValue: pendingTotal,
      delta: signed(pendingTotal),
      deltaValue: pendingTotal,
      trend: pendingTotal > 0 ? "down" : "flat",
      chipColor: "amber",
      iconKey: "folder-kanban",
      period: `${actionableTasks} action items · ${reviewSignals} signals`,
    },

    {
      id: "mc_renewal",
      label: "Acceptance Rate",
      value: totalActioned > 0 ? `${renewalRate}%` : "0%",
      rawValue: totalActioned > 0 ? renewalRate : 0,
      delta: totalActioned > 0 ? signed(renewalDelta) + "%" : "0%",
      deltaValue: totalActioned > 0 ? renewalDelta : 0,
      trend: renewalDelta > 0 ? "up" : renewalDelta < 0 ? "down" : "flat",
      chipColor: "green",
      iconKey: "trending-up",
      period: totalActioned > 0 ? "this quarter" : "no actions recorded",
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

  return {
    counts: r as CountsRaw,
    cards,
    projectStatusCounts,
    aiProcessStats,
    pendingActionStats,
    teamRoles,
  };
}

// ─── Alerts Formatter ─────────────────────────────────────────────────────────

function formatAlerts(
  atRiskProjects: Array<{ id: string; name: string; status: string; accountName: string; dueDate: Date }>,
  criticalInsights: Array<{ id: string; title: string; body: string; accountName: string | null }>,
  failedDocuments: Array<{ id: string; fileName: string; failureReason: string | null }> = [],
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  for (const doc of failedDocuments) {
    alerts.push({
      id:          `alert_doc_${doc.id}`,
      severity:    "critical",
      title:       `Processing failed: ${doc.fileName}`,
      body:        doc.failureReason ? `AI extraction failed: ${doc.failureReason}` : "AI document processing encountered an error.",
      ctaLabel:    "View documents",
      ctaHref:     "/documents",
      dismissible: true,
    });
  }

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

// ─── Recent activities ───────────────────────────────────────────────────────

type RawActivityRow = {
  id: string;
  action: string;
  details?: string | null;
  type?: string;
  createdAt: Date;
  author?: { name?: string | null; avatarInitials?: string | null } | null;
  project?: { name?: string | null } | null;
};

type RawAuditLogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: string | null;
  createdAt: Date;
  user?: { name?: string | null; avatarInitials?: string | null } | null;
};

function formatCombinedActivities(
  projectActivities: RawActivityRow[],
  auditLogs: RawAuditLogRow[] = []
): DashboardActivity[] {
  const formattedProj: DashboardActivity[] = projectActivities.map((r) => ({
    id:             r.id,
    authorName:     r.author?.name || "System User",
    authorInitials: r.author?.avatarInitials || "RF",
    projectName:    r.project?.name || "Project",
    action:         r.action,
    details:        r.details,
    type:           (r.type as DashboardActivity["type"]) || "status",
    relativeTime:   relativeTime(r.createdAt),
    createdAt:      r.createdAt.toISOString(),
  }));

  const formattedAudit: DashboardActivity[] = auditLogs.map((log) => {
    let actionLabel = log.action.replace(/[._]/g, " ");
    let projectName = "Workspace";
    let type: DashboardActivity["type"] = "milestone";
    let authorName = log.user?.name || "AI Engine";
    let authorInitials = log.user?.avatarInitials || (log.user ? "RF" : "AI");

    if (log.action.includes("ai_replied")) {
      actionLabel = "AI drafted customer response";
      projectName = "Customer Support";
      type = "comment";
      authorName = "AI Responder";
      authorInitials = "AI";
    } else if (log.action.includes("escalated")) {
      actionLabel = "Customer conversation escalated to agent";
      projectName = "Customer Support";
      type = "status";
      authorName = "AI Monitor";
      authorInitials = "AI";
    } else if (log.action.includes("invited")) {
      actionLabel = "Invited new team member";
      projectName = "Access";
      type = "milestone";
    } else if (log.action.includes("document")) {
      actionLabel = "Document uploaded";
      projectName = "Knowledge Base";
      type = "milestone";
    }

    return {
      id:             `audit_${log.id}`,
      authorName,
      authorInitials,
      projectName,
      action:         actionLabel,
      details:        null,
      type,
      relativeTime:   relativeTime(log.createdAt),
      createdAt:      log.createdAt.toISOString(),
    };
  });

  return [...formattedProj, ...formattedAudit]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);
}

// ─── Real Time-Series History Computation ────────────────────────────────────

function computeInsightHistory(rows: Array<{ createdAt: Date }>, now: Date): InsightHistoryPoint[] {
  const points = 8;
  const history: InsightHistoryPoint[] = [];
  const intervalMs = (30 / points) * 86_400_000;
  const nowMs = now.getTime();

  for (let i = points - 1; i >= 0; i--) {
    const intervalEnd = nowMs - i * intervalMs;
    const intervalStart = intervalEnd - intervalMs;
    const d = new Date(intervalEnd);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;

    let count = 0;
    for (const row of rows) {
      const t = row.createdAt.getTime();
      if (t >= intervalStart && t < intervalEnd) {
        count++;
      }
    }

    history.push({ date: label, count });
  }
  return history;
}

function computeConversationHistory(rows: Array<{ updatedAt: Date }>, now: Date): ConversationHistoryPoint[] {
  const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const todayIdx = (now.getDay() + 6) % 7;
  const orderedDays: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const idx = (todayIdx - i + 7) % 7;
    orderedDays.push(days[idx]);
  }

  const dayMs = 86_400_000;
  const nowMs = now.getTime();
  const buckets = [0, 0, 0, 0, 0, 0, 0];

  for (const row of rows) {
    const diff = nowMs - row.updatedAt.getTime();
    const dayAgo = Math.floor(diff / dayMs);
    if (dayAgo >= 0 && dayAgo < 7) {
      buckets[6 - dayAgo]++;
    }
  }

  return orderedDays.map((day, i) => ({
    day,
    count: buckets[i] ?? 0,
  }));
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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const sevenDaysAgo  = new Date(now.getTime() - 7 * 86_400_000);

    // Check organization dashboard cache
    const cached = dashboardCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json(cached.data);
    }

    // Parallel DB round-trips for the dashboard overview:
    // 1: Aggregated metrics & counts (single SQL query)
    // 2: Recent Projects (top 5)
    // 3: Recent Insights (top 5)
    // 4: Recent Conversations (top 5 with last message)
    // 5: Recent Activities (top 5 from ProjectActivity)
    // 6: Non-project audit logs (top 5 from AuditLog)
    // 7: 30-day Insight timestamps (for real activity sparkline)
    // 8: 7-day Conversation timestamps (for real activity bars)
    // 9: Failed documents (for alerts)
    const [
      aggregatedCountsRes,
      projectsRes,
      insightsRes,
      conversationsRes,
      activitiesRes,
      auditLogsRes,
      insightDatesRes,
      conversationDatesRes,
      failedDocsRes,
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
      prisma.projectActivity.findMany({
        where:   { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take:    5,
        select: {
          id:        true,
          action:    true,
          details:   true,
          type:      true,
          createdAt: true,
          author:    { select: { name: true, avatarInitials: true } },
          project:   { select: { name: true } },
        },
      }),
      prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          entityType: { notIn: ["project", "task"] },
        },
        orderBy: { createdAt: "desc" },
        take:    5,
        select: {
          id:           true,
          action:       true,
          entityType:   true,
          entityId:     true,
          metadataJson: true,
          createdAt:    true,
          user:         { select: { name: true, avatarInitials: true } },
        },
      }),
      prisma.insight.findMany({
        where:   { organizationId: orgId, createdAt: { gte: thirtyDaysAgo } },
        select:  { createdAt: true },
      }),
      prisma.conversation.findMany({
        where:   { organizationId: orgId, updatedAt: { gte: sevenDaysAgo } },
        select:  { updatedAt: true },
      }),
      prisma.document.findMany({
        where:   { organizationId: orgId, processingStatus: "FAILED" },
        take:    3,
        select:  { id: true, fileName: true, failureReason: true },
      }),
    ]);

    const countsData = aggregatedCountsRes.status === "fulfilled" ? aggregatedCountsRes.value : null;
    const metricCards = countsData?.cards ?? [];
    const unreadInsightCount = countsData?.counts ? Number(countsData.counts.unread_insights ?? 0) : 0;

    const rawProjects = projectsRes.status === "fulfilled" ? projectsRes.value : [];
    const rawInsights = insightsRes.status === "fulfilled" ? insightsRes.value : [];
    const rawConversations = conversationsRes.status === "fulfilled" ? conversationsRes.value : [];
    const rawActivities = activitiesRes.status === "fulfilled" ? activitiesRes.value : [];
    const rawAuditLogs = auditLogsRes.status === "fulfilled" ? auditLogsRes.value : [];
    const rawInsightDates = insightDatesRes.status === "fulfilled" ? insightDatesRes.value : [];
    const rawConversationDates = conversationDatesRes.status === "fulfilled" ? conversationDatesRes.value : [];
    const rawFailedDocs = failedDocsRes.status === "fulfilled" ? failedDocsRes.value : [];

    // Derive alerts in-memory from fetched lists without additional round-trips
    const atRiskProjects = rawProjects
      .filter((p) => p.status === "AT_RISK" || p.status === "BLOCKED")
      .slice(0, 3);
    const criticalInsights = rawInsights
      .filter((i) => i.severity === "CRITICAL" && !i.read && (!i.actions || i.actions.length === 0 || !["DISMISSED", "ACCEPTED"].includes(i.actions[0].actionStatus)))
      .slice(0, 3);
    const alerts = formatAlerts(atRiskProjects, criticalInsights, rawFailedDocs);

    // Compute real historical charts
    const insightHistory = computeInsightHistory(rawInsightDates, now);
    const conversationHistory = computeConversationHistory(rawConversationDates, now);
    const recentActivities = formatCombinedActivities(
      rawActivities as RawActivityRow[],
      rawAuditLogs as RawAuditLogRow[]
    );

    const countsFailed = aggregatedCountsRes.status === "rejected";
    const errors: Record<string, any> = {
      projects: projectsRes.status === "rejected",
      insights: insightsRes.status === "rejected",
      metrics: countsFailed,
      alerts: projectsRes.status === "rejected" || insightsRes.status === "rejected",
      conversations: conversationsRes.status === "rejected",
      activities: activitiesRes.status === "rejected" && auditLogsRes.status === "rejected",
      counts: {
        projects: countsFailed,
        conversations: countsFailed,
        insights: countsFailed,
        renewal: countsFailed,
        team: countsFailed,
        aiProcesses: countsFailed,
        pendingActions: countsFailed,
      },
    };

    const payload: DashboardData = {
      userName:           session.name || "there",
      metricCards,
      projects:           rawProjects.slice(0, 5).map((p) => serializeProject(p as ProjectRow)),
      projectStatusCounts: countsData?.projectStatusCounts,
      aiProcessStats:     countsData?.aiProcessStats,
      pendingActionStats: countsData?.pendingActionStats,
      recentActivities,
      insights:           rawInsights.slice(0, 5).map((r) => serializeInsight(r as RawInsight)),
      unreadInsightCount,
      insightHistory,
      alerts,
      recentConversations: formatRecentConversations(rawConversations as RawConvRow[]),
      conversationHistory,
      teamRoles:          countsData?.teamRoles,
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
