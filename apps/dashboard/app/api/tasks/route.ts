import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { invalidateDashboardCache } from "@/app/api/dashboard/route";
import type { TaskDto, TaskPriority, TaskStatus, TasksResponse } from "@/app/types/task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RawTaskWithRelations {
  id: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  projectId: string | null;
  project: {
    id: string;
    name: string;
    accountName: string;
  } | null;
  assignee: {
    id: string;
    name: string;
    avatarInitials: string;
  } | null;
}

function parseTaskMetadata(task: {
  title: string;
  description: string | null;
}): {
  cleanTitle: string;
  cleanDescription: string | null;
  insightId: string | null;
  priority: TaskPriority;
} {
  let cleanTitle = task.title;
  let cleanDescription = task.description;
  let insightId: string | null = null;
  let priority: TaskPriority = "MEDIUM";

  if (task.title.startsWith("[Insight] ")) {
    cleanTitle = task.title.replace(/^\[Insight\]\s*/, "");
  }

  if (task.description) {
    const idMatch = task.description.match(/\[insightId:([a-zA-Z0-9_\-]+)\]/);
    if (idMatch) {
      insightId = idMatch[1];
    }
    const prioMatch = task.description.match(/\[priority:(HIGH|MEDIUM|LOW)\]/i);
    if (prioMatch) {
      priority = prioMatch[1].toUpperCase() as TaskPriority;
    }
    // Clean out metadata tags for display
    cleanDescription = task.description
      .replace(/\[insightId:[a-zA-Z0-9_\-]+\]/g, "")
      .replace(/\[priority:(HIGH|MEDIUM|LOW)\]/gi, "")
      .trim();
    if (!cleanDescription) cleanDescription = null;
  }

  return { cleanTitle, cleanDescription, insightId, priority };
}

/**
 * GET /api/tasks
 *
 * Query params:
 *   - status: "TODO" | "IN_PROGRESS" | "DONE" | "open"
 *   - projectId: string | "none" (for project-independent tasks)
 *   - search: string
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const projectParam = searchParams.get("projectId");
  const searchParam = searchParams.get("search");

  const whereClause: Record<string, any> = {
    organizationId: session.organizationId,
  };

  if (statusParam === "open") {
    whereClause.status = { not: "DONE" };
  } else if (statusParam && ["TODO", "IN_PROGRESS", "DONE"].includes(statusParam)) {
    whereClause.status = statusParam;
  }

  if (projectParam === "none" || projectParam === "unassigned") {
    whereClause.projectId = null;
  } else if (projectParam) {
    whereClause.projectId = projectParam;
  }

  if (searchParam && searchParam.trim().length > 0) {
    whereClause.OR = [
      { title: { contains: searchParam.trim(), mode: "insensitive" } },
      { description: { contains: searchParam.trim(), mode: "insensitive" } },
    ];
  }

  const tasks = (await prisma.task.findMany({
    where: whereClause,
    include: {
      project: {
        select: { id: true, name: true, accountName: true },
      },
      assignee: {
        select: { id: true, name: true, avatarInitials: true },
      },
    },
    orderBy: [
      { status: "asc" },
      { createdAt: "desc" },
    ],
  })) as RawTaskWithRelations[];

  // Extract insight candidates for batch resolution
  const insightIds = new Set<string>();
  const parsedMetaList = tasks.map((task) => {
    const meta = parseTaskMetadata(task);
    if (meta.insightId) {
      insightIds.add(meta.insightId);
    }
    return meta;
  });

  // Batch query insights in the caller's organization
  const matchingInsights = insightIds.size > 0
    ? await prisma.insight.findMany({
        where: {
          organizationId: session.organizationId,
          id: { in: Array.from(insightIds) },
        },
        select: {
          id: true,
          title: true,
          type: true,
          severity: true,
        },
      })
    : [];

  const insightMap = new Map(matchingInsights.map((i) => [i.id, i]));

  let openCount = 0;
  let doneCount = 0;

  const formattedTasks: TaskDto[] = tasks.map((task, idx) => {
    const meta = parsedMetaList[idx];
    const sourceInsight = meta.insightId ? insightMap.get(meta.insightId) ?? null : null;

    let priority = meta.priority;
    if (sourceInsight && priority === "MEDIUM") {
      if (sourceInsight.severity === "CRITICAL") priority = "HIGH";
      else if (sourceInsight.severity === "INFO") priority = "LOW";
    }

    if (task.status === "DONE") {
      doneCount++;
    } else {
      openCount++;
    }

    return {
      id: task.id,
      title: task.title,
      cleanTitle: meta.cleanTitle,
      description: meta.cleanDescription,
      status: task.status as TaskStatus,
      priority,
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      projectId: task.projectId,
      project: task.project,
      assignee: task.assignee,
      sourceInsight: sourceInsight ? {
        id: sourceInsight.id,
        title: sourceInsight.title,
        type: sourceInsight.type,
        severity: sourceInsight.severity,
      } : null,
    };
  });

  const responsePayload: TasksResponse = {
    tasks: formattedTasks,
    total: formattedTasks.length,
    openCount,
    doneCount,
  };

  return Response.json(responsePayload);
}

/**
 * POST /api/tasks
 *
 * Body: {
 *   title: string;
 *   description?: string;
 *   projectId?: string;
 *   assigneeId?: string;
 *   dueDate?: string;
 *   priority?: "HIGH" | "MEDIUM" | "LOW";
 *   insightId?: string;
 * }
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, description, projectId, assigneeId, dueDate, priority, insightId } = body;

  if (typeof title !== "string" || !title.trim()) {
    return Response.json({ error: "title is required" }, { status: 422 });
  }

  // Verify project belongs to session org if supplied
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: session.organizationId },
      select: { id: true, name: true },
    });
    if (!project) {
      return Response.json({ error: "Project not found in this organization" }, { status: 404 });
    }
  }

  // Verify assignee belongs to session org if supplied
  if (assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assigneeId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!assignee) {
      return Response.json({ error: "Assignee not found in this organization" }, { status: 404 });
    }
  }

  let insight: { id: string; title: string; severity: string } | null = null;
  if (insightId) {
    insight = await prisma.insight.findFirst({
      where: { id: insightId, organizationId: session.organizationId },
      select: { id: true, title: true, severity: true },
    });
    if (!insight) {
      return Response.json({ error: "Insight not found in this organization" }, { status: 404 });
    }

    // Duplicate prevention: check if a task for this insight already exists in this org
    const existing = await prisma.task.findFirst({
      where: {
        organizationId: session.organizationId,
        OR: [
          { description: { contains: `[insightId:${insightId}]` } },
          { title: `[Insight] ${insight.title}` },
        ],
      },
      include: {
        project: { select: { id: true, name: true, accountName: true } },
        assignee: { select: { id: true, name: true, avatarInitials: true } },
      },
    });

    if (existing) {
      const meta = parseTaskMetadata(existing);
      return Response.json({
        task: {
          id: existing.id,
          title: existing.title,
          cleanTitle: meta.cleanTitle,
          description: meta.cleanDescription,
          status: existing.status,
          priority: meta.priority,
          dueDate: existing.dueDate ? existing.dueDate.toISOString() : null,
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
          projectId: existing.projectId,
          project: existing.project,
          assignee: existing.assignee,
          sourceInsight: {
            id: insight.id,
            title: insight.title,
            type: "RISK",
            severity: insight.severity,
          },
        },
        alreadyExisted: true,
        message: "A task already exists for this insight",
      }, { status: 200 });
    }
  }

  // Construct description with safe structured metadata tags
  let finalDesc = (typeof description === "string" ? description.trim() : "");
  if (insightId) {
    const prio = priority || (insight?.severity === "CRITICAL" ? "HIGH" : insight?.severity === "INFO" ? "LOW" : "MEDIUM");
    finalDesc = `[insightId:${insightId}][priority:${prio}] ${finalDesc}`.trim();
  } else if (priority && ["HIGH", "MEDIUM", "LOW"].includes(String(priority).toUpperCase())) {
    finalDesc = `[priority:${String(priority).toUpperCase()}] ${finalDesc}`.trim();
  }

  const finalTitle = insightId && !title.startsWith("[Insight] ")
    ? `[Insight] ${title.trim()}`
    : title.trim();

  const parsedDueDate = dueDate ? new Date(dueDate) : null;

  const newTask = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        organizationId: session.organizationId,
        title: finalTitle,
        description: finalDesc || null,
        projectId: projectId ?? null,
        assigneeId: assigneeId ?? null,
        dueDate: parsedDueDate,
        status: "TODO",
      },
      include: {
        project: { select: { id: true, name: true, accountName: true } },
        assignee: { select: { id: true, name: true, avatarInitials: true } },
      },
    });

    // Update project stats & activities if linked
    if (projectId) {
      const allTasks = await tx.task.findMany({
        where: { projectId },
        select: { status: true },
      });
      const totalCount = allTasks.length;
      const doneCount = allTasks.filter((t) => t.status === "DONE").length;
      const openTasksCount = totalCount - doneCount;
      const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

      await tx.project.update({
        where: { id: projectId },
        data: { openTasksCount, progress },
      });

      await tx.projectActivity.create({
        data: {
          organizationId: session.organizationId,
          projectId,
          authorId: session.userId,
          action: `Added task: ${created.title}`,
          type: "task",
        },
      });
    }

    // Record insight action & mark read if linked
    if (insightId) {
      await tx.insight.update({
        where: { id: insightId },
        data: { read: true },
      });

      await tx.insightAction.create({
        data: {
          organizationId: session.organizationId,
          insightId,
          actionStatus: "TASK_CREATED",
        },
      });
    }

    return created;
  });

  // Invalidate cache immediately so dashboard reflects new task
  invalidateDashboardCache(session.organizationId);

  const { notifyOrgDataChanged } = await import("@/app/lib/data-sync");
  await notifyOrgDataChanged(session.organizationId, ["tasks", "projects", "insights"]);

  const meta = parseTaskMetadata(newTask);
  const formatted: TaskDto = {
    id: newTask.id,
    title: newTask.title,
    cleanTitle: meta.cleanTitle,
    description: meta.cleanDescription,
    status: newTask.status as TaskStatus,
    priority: meta.priority,
    dueDate: newTask.dueDate ? newTask.dueDate.toISOString() : null,
    createdAt: newTask.createdAt.toISOString(),
    updatedAt: newTask.updatedAt.toISOString(),
    projectId: newTask.projectId,
    project: newTask.project,
    assignee: newTask.assignee,
    sourceInsight: insight ? {
      id: insight.id,
      title: insight.title,
      type: "RISK",
      severity: insight.severity,
    } : null,
  };

  return Response.json({ task: formatted }, { status: 201 });
}
