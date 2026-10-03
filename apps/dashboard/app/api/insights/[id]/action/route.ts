import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import type { Insight, InsightActionStatus, ChartDataPoint } from "@/app/types/insight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS = ["ACCEPTED", "DISMISSED", "TASK_CREATED"] as const;

function parseChartData(json: string): ChartDataPoint[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ChartDataPoint[]) : [];
  } catch {
    return [];
  }
}

/**
 * POST /api/insights/:id/action
 *
 * Body: { action: "ACCEPTED" | "DISMISSED" | "TASK_CREATED" }
 *
 * Security:
 *   - The insight is loaded with organizationId === session.organizationId,
 *     so an insight from another org simply 404s.
 *   - When action === "TASK_CREATED" a Task row is created in the same org,
 *     scoped to organizationId from the session (never from the request body).
 *
 * Returns the full updated Insight shape so the UI can replace its local copy
 * directly from the response rather than doing a separate GET.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: insightId } = await params;

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (typeof action !== "string" || !VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
    return Response.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 422 },
    );
  }

  const typedAction = action as InsightActionStatus;

  // Load the insight — scoped to this org (other orgs 404)
  const insight = await prisma.insight.findFirst({
    where: { id: insightId, organizationId: session.organizationId },
    select: {
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
    },
  });

  if (!insight) {
    return Response.json({ error: "Insight not found" }, { status: 404 });
  }

  // Run all writes in a transaction
  const [insightAction] = await prisma.$transaction(async (tx) => {
    // 1. Mark insight as read
    await tx.insight.update({
      where: { id: insightId },
      data:  { read: true },
    });

    // 2. Record the action
    const newAction = await tx.insightAction.create({
      data: {
        organizationId: session.organizationId,
        insightId,
        actionStatus: typedAction,
      },
      select: { actionStatus: true },
    });

    // 3. If "Create Task" — materialise a Task row linked to no specific
    //    project (can be assigned later). Title comes from the insight.
    //    Prevent duplicate task creation on repeated requests.
    if (typedAction === "TASK_CREATED") {
      const existingTask = await tx.task.findFirst({
        where: {
          organizationId: session.organizationId,
          OR: [
            { description: { contains: `[insightId:${insight.id}]` } },
            { title: `[Insight] ${insight.title}` },
          ],
        },
      });

      if (!existingTask) {
        const priorityTag = insight.severity === "CRITICAL" ? "HIGH" : insight.severity === "WARNING" ? "MEDIUM" : "LOW";
        await tx.task.create({
          data: {
            organizationId: session.organizationId,
            title:       `[Insight] ${insight.title}`,
            description: `[insightId:${insight.id}][priority:${priorityTag}] ${insight.recommendedAction}`,
            status:      "TODO",
            assigneeId:  session.userId,
          },
        });
      }
    }

    return [newAction] as const;
  });

  // Re-read the now-updated insight to return a consistent server shape
  const updated: Insight = {
    id:             insight.id,
    organizationId: insight.organizationId,
    type:           insight.type as Insight["type"],
    severity:       insight.severity as Insight["severity"],
    title:          insight.title,
    body:           insight.body,
    accountName:    insight.accountName,
    ctaHref:        insight.ctaHref,
    ctaLabel:       insight.ctaLabel,
    read:           true,
    actionStatus:   insightAction.actionStatus as InsightActionStatus,
    createdAt:      insight.createdAt.toISOString(),
    detail: {
      whatHappened:      insight.whatHappened,
      whyDetected:       insight.whyDetected,
      chartTitle:        insight.chartTitle,
      chartType:         insight.chartType as Insight["detail"]["chartType"],
      chartData:         parseChartData(insight.chartDataJson),
      businessImpact:    insight.businessImpact,
      recommendedAction: insight.recommendedAction,
    },
  };

  // Invalidate dashboard cache immediately so pending actions & insight counts update
  const { invalidateDashboardCache } = await import("@/app/api/dashboard/route");
  invalidateDashboardCache(session.organizationId);

  const { notifyOrgDataChanged } = await import("@/app/lib/data-sync");
  await notifyOrgDataChanged(session.organizationId, ["insights", "alerts", "tasks"]);

  const { trackEvent } = await import("@/app/lib/analytics");
  if (typedAction === "ACCEPTED") {
    trackEvent("insight_accepted", { insightId, title: insight.title }, { organizationId: session.organizationId, userId: session.userId });
  } else if (typedAction === "DISMISSED") {
    trackEvent("insight_dismissed", { insightId, title: insight.title }, { organizationId: session.organizationId, userId: session.userId });
  }

  return Response.json({ insight: updated });
}
