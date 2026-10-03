import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getSession = vi.fn();

  const mockCountsRow = {
    active_projects: BigInt(5),
    prev_projects: BigInt(4),
    proj_on_track: BigInt(3),
    proj_at_risk: BigInt(1),
    proj_blocked: BigInt(1),
    proj_completed: BigInt(2),
    open_convs: BigInt(2),
    prev_convs: BigInt(1),
    ins_30d: BigInt(12),
    ins_60d: BigInt(8),
    unread_insights: BigInt(3),
    members: BigInt(6),
    prev_members: BigInt(5),
    total_actioned: BigInt(0), // 0 to test removal of 94% fallback
    accepted_actioned: BigInt(0),
    prev_total: BigInt(0),
    prev_accepted: BigInt(0),
    ai_docs_pending: BigInt(2),
    ai_docs_processed: BigInt(10),
    ai_docs_failed: BigInt(1),
    ai_reports_processing: BigInt(1),
    ai_reports_ready: BigInt(5),
    ai_reports_failed: BigInt(0),
    ai_convs_handling: BigInt(1),
    pending_tasks: BigInt(4),
    pending_escalations: BigInt(2),
    users_admin: BigInt(2),
    users_member: BigInt(3),
    users_client_admin: BigInt(0),
    users_client_employee: BigInt(1),
    invites_pending: BigInt(1),
  };

  const queryRaw = vi.fn(async () => [mockCountsRow]);

  const projectsFindMany = vi.fn(async (args: any) => {
    if (args?.where?.organizationId !== "org_tenant_1") {
      return [];
    }
    return [
      {
        id: "p1",
        name: "Acme Migration",
        accountName: "Acme Corp",
        status: "ON_TRACK",
        progress: 65,
        dueDate: new Date("2026-11-01T00:00:00Z"),
        openTasksCount: 2,
        ownerId: "u1",
        owner: { id: "u1", name: "Alice Admin" },
        tasks: [],
        activities: [],
      },
      {
        id: "p2",
        name: "Beta Rollout",
        accountName: "Beta LLC",
        status: "AT_RISK",
        progress: 30,
        dueDate: new Date("2026-10-10T00:00:00Z"),
        openTasksCount: 5,
        ownerId: "u1",
        owner: { id: "u1", name: "Alice Admin" },
        tasks: [],
        activities: [],
      },
    ];
  });

  const insightsFindMany = vi.fn(async (args: any) => {
    if (args?.where?.organizationId !== "org_tenant_1") {
      return [];
    }
    return [
      {
        id: "ins_1",
        organizationId: "org_tenant_1",
        type: "RISK",
        severity: "CRITICAL",
        title: "High API Error Rate",
        body: "Rate spiked by 40%",
        accountName: "Acme Corp",
        ctaHref: "/ai-insights",
        ctaLabel: "View details",
        read: false,
        whatHappened: "Errors increased",
        whyDetected: "Anomaly filter",
        chartTitle: "API Errors",
        chartType: "line",
        chartDataJson: "[]",
        businessImpact: "Medium",
        recommendedAction: "Investigate logs",
        createdAt: new Date("2026-09-25T12:00:00Z"),
        actions: [],
      },
    ];
  });

  const conversationsFindMany = vi.fn(async (args: any) => {
    if (args?.where?.organizationId !== "org_tenant_1") {
      return [];
    }
    return [
      {
        id: "c1",
        topic: "Feature request",
        contextLabel: "Support",
        rfLead: "Agent Smith",
        unread: true,
        updatedAt: new Date("2026-09-28T14:00:00Z"),
        messages: [
          {
            content: "Can you help us?",
            createdAt: new Date("2026-09-28T14:00:00Z"),
            sender: { name: "Bob", avatarInitials: "BO" },
          },
        ],
      },
    ];
  });

  const activitiesFindMany = vi.fn(async (args: any) => {
    if (args?.where?.organizationId !== "org_tenant_1") {
      return [];
    }
    return [
      {
        id: "act_1",
        action: "Created subtask",
        details: "Audit database indexes",
        type: "task",
        createdAt: new Date("2026-09-29T10:00:00Z"),
        author: { name: "Alice Admin", avatarInitials: "AA" },
        project: { name: "Acme Migration" },
      },
    ];
  });

  const documentsFindMany = vi.fn(async (args: any) => {
    if (args?.where?.organizationId !== "org_tenant_1") {
      return [];
    }
    return [
      {
        id: "doc_fail_1",
        fileName: "corrupt_invoice.pdf",
        failureReason: "Malformed PDF syntax",
      },
    ];
  });

  const auditLogsFindMany = vi.fn(async (args: any) => {
    if (args?.where?.organizationId !== "org_tenant_1") {
      return [];
    }
    return [
      {
        id: "audit_1",
        action: "customer_conversations.ai_replied",
        entityType: "customer_conversation",
        entityId: "cc_1",
        metadataJson: null,
        createdAt: new Date("2026-09-30T10:00:00Z"),
        user: null,
      },
    ];
  });

  return {
    getSession,
    queryRaw,
    projectsFindMany,
    insightsFindMany,
    conversationsFindMany,
    activitiesFindMany,
    documentsFindMany,
    auditLogsFindMany,
    mockCountsRow,
  };
});

vi.mock("@/app/lib/session", () => ({
  getSession: h.getSession,
}));

vi.mock("@/app/lib/db", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
  },
  prisma: {
    $queryRaw: h.queryRaw,
    project: { findMany: h.projectsFindMany },
    insight: { findMany: h.insightsFindMany },
    conversation: { findMany: h.conversationsFindMany },
    projectActivity: { findMany: h.activitiesFindMany },
    document: { findMany: h.documentsFindMany },
    auditLog: { findMany: h.auditLogsFindMany },
  },
}));

// Import GET route and cache invalidator
import { GET, invalidateDashboardCache } from "./route";

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateDashboardCache("org_tenant_1");
    invalidateDashboardCache("org_tenant_2");
  });

  it("returns 401 when caller is unauthenticated", async () => {
    h.getSession.mockResolvedValueOnce(null);

    const res = await GET();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("enforces tenant isolation and returns client-required primary information architecture", async () => {
    h.getSession.mockResolvedValueOnce({
      userId: "u1",
      organizationId: "org_tenant_1",
      role: "ADMIN",
      name: "Alice Admin",
      email: "alice@example.com",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    // 1. User greeting
    expect(json.userName).toBe("Alice Admin");

    // 2. Exact 6 Client Requirements surfaced in primary architecture:
    // Requirement 1: Active Projects
    const activeProjectsCard = json.metricCards.find((c: any) => c.id === "mc_projects");
    expect(activeProjectsCard).toBeDefined();
    expect(activeProjectsCard.label).toBe("Active Projects");
    expect(activeProjectsCard.rawValue).toBe(5);
    expect(json.projectStatusCounts).toEqual({
      onTrack: 3,
      atRisk: 1,
      blocked: 1,
      completed: 2,
      total: 5,
    });

    // Requirement 2: AI Tasks / Processes
    const aiProcessCard = json.metricCards.find((c: any) => c.id === "mc_ai_processes");
    expect(aiProcessCard).toBeDefined();
    expect(aiProcessCard.label).toBe("AI Tasks / Processes");
    // Queued: 2 docs pending
    // Processing: 1 report processing
    // Active Conversations: 1
    // Completed: 10 docs + 5 reports = 15
    // Failed: 1 doc + 0 reports = 1
    // Total = 20
    expect(json.aiProcessStats).toEqual({
      queued: 2,
      processing: 1,
      activeConversations: 1,
      active: 4,
      completed: 15,
      failed: 1,
      total: 20,
    });
    expect(aiProcessCard.rawValue).toBe(20);

    // Requirement 3: Insights Generated
    const insightsCard = json.metricCards.find((c: any) => c.id === "mc_insights");
    expect(insightsCard).toBeDefined();
    expect(insightsCard.label).toBe("Insights Generated");
    expect(insightsCard.rawValue).toBe(12);

    // Requirement 4: Pending Actions
    const pendingActionsCard = json.metricCards.find((c: any) => c.id === "mc_pending_actions");
    expect(pendingActionsCard).toBeDefined();
    expect(pendingActionsCard.label).toBe("Pending Actions");
    // Action items: openTasks (4) + escalations (2) = 6
    // Review signals: unreadInsights (3) + atRiskProjects (2) = 5
    // Total = 11
    expect(json.pendingActionStats).toEqual({
      actionableTasks: 6,
      reviewSignals: 5,
      total: 11,
      openTasks: 4,
      unreadInsights: 3,
      escalations: 2,
      atRiskProjects: 2,
    });
    expect(pendingActionsCard.rawValue).toBe(11);

    // Requirement 5: Recent Activity (merges non-project audit logs + project activities chronologically)
    expect(json.recentActivities).toHaveLength(2);
    expect(json.recentActivities[0]).toMatchObject({
      id: "audit_audit_1",
      action: "AI drafted customer response",
      authorName: "AI Responder",
      authorInitials: "AI",
      projectName: "Customer Support",
    });
    expect(json.recentActivities[1]).toMatchObject({
      id: "act_1",
      authorName: "Alice Admin",
      authorInitials: "AA",
      projectName: "Acme Migration",
      action: "Created subtask",
      details: "Audit database indexes",
      type: "task",
    });

    // Requirement 6: Important Alerts
    expect(json.alerts.length).toBeGreaterThan(0);
    const docAlert = json.alerts.find((a: any) => a.id.startsWith("alert_doc_"));
    expect(docAlert).toBeDefined();
    expect(docAlert.title).toContain("Processing failed");

    // 3. Removed 94% fallback verification:
    const renewalCard = json.metricCards.find((c: any) => c.id === "mc_renewal");
    expect(renewalCard).toBeDefined();
    expect(renewalCard.value).toBe("0%");
    expect(renewalCard.rawValue).toBe(0);
    expect(renewalCard.period).toBe("no actions recorded");

    // 4. Secondary operations metrics verification:
    const convCard = json.metricCards.find((c: any) => c.id === "mc_conversations");
    expect(convCard).toBeDefined();
    expect(convCard.rawValue).toBe(2);

    const teamCard = json.metricCards.find((c: any) => c.id === "mc_team");
    expect(teamCard).toBeDefined();
    expect(teamCard.rawValue).toBe(6);
    expect(json.teamRoles).toEqual({
      admin: 2,
      member: 4,
      viewer: 0,
      pending: 1,
      total: 6,
    });
  });

  it("never counts document-generated reports twice in aggregation SQL query", async () => {
    h.getSession.mockResolvedValueOnce({
      userId: "u1",
      organizationId: "org_tenant_1",
      role: "ADMIN",
      name: "Alice Admin",
      email: "alice@example.com",
    });

    await GET();

    // Verify $queryRaw was called with SQL that distinguishes standalone reports by documentId IS NULL
    expect(h.queryRaw).toHaveBeenCalledTimes(1);
    const queryArg: any = (h.queryRaw.mock.calls as any)[0]?.[0];
    const sqlText = queryArg?.strings?.join(" ") ?? "";

    // Must filter reports with documentId IS NULL so document extractions aren't counted twice
    expect(sqlText).toContain('"documentId" IS NULL');
    // Must filter insights to exclude accepted or dismissed actions
    expect(sqlText).toContain('"actionStatus"::text IN (\'ACCEPTED\', \'DISMISSED\')');
  });

  it("safely handles empty activity feeds and missing author/project fields", async () => {
    h.getSession.mockResolvedValueOnce({
      userId: "u1",
      organizationId: "org_tenant_1",
      role: "ADMIN",
      name: "Alice Admin",
      email: "alice@example.com",
    });

    // Return activities with missing relations
    h.activitiesFindMany.mockResolvedValueOnce([
      {
        id: "act_orphan",
        action: "Status updated",
        details: null,
        type: "status",
        createdAt: new Date("2026-10-01T00:00:00Z"),
        author: null,
        project: null,
      } as any,
    ]);
    h.auditLogsFindMany.mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.recentActivities).toHaveLength(1);
    expect(json.recentActivities[0]).toMatchObject({
      id: "act_orphan",
      authorName: "System User",
      authorInitials: "RF",
      projectName: "Project",
      action: "Status updated",
      type: "status",
    });
  });

  it("never returns data belonging to another tenant", async () => {
    h.getSession.mockResolvedValueOnce({
      userId: "u2",
      organizationId: "org_tenant_2",
      role: "ADMIN",
      name: "Other Admin",
      email: "other@example.com",
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    // Since mock findMany checks organizationId === "org_tenant_1", tenant 2 gets empty lists
    expect(json.projects).toEqual([]);
    expect(json.insights).toEqual([]);
    expect(json.recentConversations).toEqual([]);
    expect(json.recentActivities).toEqual([]);
  });
});
