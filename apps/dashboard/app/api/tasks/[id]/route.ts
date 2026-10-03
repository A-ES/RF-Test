import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { invalidateDashboardCache } from "@/app/api/dashboard/route";
import type { TaskDto, TaskPriority, TaskStatus } from "@/app/types/task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;

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
    cleanDescription = task.description
      .replace(/\[insightId:[a-zA-Z0-9_\-]+\]/g, "")
      .replace(/\[priority:(HIGH|MEDIUM|LOW)\]/gi, "")
      .trim();
    if (!cleanDescription) cleanDescription = null;
  }

  return { cleanTitle, cleanDescription, insightId, priority };
}

/**
 * PATCH /api/tasks/:id
 *
 * Body: {
 *   status?: "TODO" | "IN_PROGRESS" | "DONE";
 *   title?: string;
 *   description?: string | null;
 *   dueDate?: string | null;
 *   assigneeId?: string | null;
 *   projectId?: string | null;
 *   priority?: "HIGH" | "MEDIUM" | "LOW";
 * }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  if (!taskId) {
    return Response.json({ error: "Task ID is required" }, { status: 400 });
  }

  // Tenant scoping: load existing task belonging to this org
  const existingTask = await prisma.task.findFirst({
    where: { id: taskId, organizationId: session.organizationId },
    include: {
      project: { select: { id: true, name: true, accountName: true } },
      assignee: { select: { id: true, name: true, avatarInitials: true } },
    },
  });

  if (!existingTask) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, title, description, dueDate, assigneeId, projectId, priority } = body;

  const dataToUpdate: Record<string, any> = {};

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return Response.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 422 }
      );
    }
    dataToUpdate.status = status;
  }

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return Response.json({ error: "title must be a non-empty string" }, { status: 422 });
    }
    dataToUpdate.title = title.trim();
  }

  if (dueDate !== undefined) {
    dataToUpdate.dueDate = dueDate ? new Date(dueDate) : null;
  }

  if (assigneeId !== undefined) {
    if (assigneeId) {
      const user = await prisma.user.findFirst({
        where: { id: assigneeId, organizationId: session.organizationId },
      });
      if (!user) {
        return Response.json({ error: "Assignee not found in this organization" }, { status: 404 });
      }
    }
    dataToUpdate.assigneeId = assigneeId || null;
  }

  if (projectId !== undefined) {
    if (projectId) {
      const proj = await prisma.project.findFirst({
        where: { id: projectId, organizationId: session.organizationId },
      });
      if (!proj) {
        return Response.json({ error: "Project not found in this organization" }, { status: 404 });
      }
    }
    dataToUpdate.projectId = projectId || null;
  }

  // Preserve existing metadata tags (like insightId) if description or priority is changed
  if (description !== undefined || priority !== undefined) {
    const meta = parseTaskMetadata(existingTask);
    const newDesc = description !== undefined ? (description || "") : (meta.cleanDescription || "");
    const newPrio = priority || meta.priority;
    let finalDesc = newDesc;

    if (meta.insightId) {
      finalDesc = `[insightId:${meta.insightId}][priority:${newPrio}] ${finalDesc}`.trim();
    } else if (newPrio) {
      finalDesc = `[priority:${newPrio}] ${finalDesc}`.trim();
    }
    dataToUpdate.description = finalDesc || null;
  }

  const oldProjectId = existingTask.projectId;
  const newProjectId = dataToUpdate.projectId !== undefined ? dataToUpdate.projectId : oldProjectId;

  const updatedTask = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: dataToUpdate,
      include: {
        project: { select: { id: true, name: true, accountName: true } },
        assignee: { select: { id: true, name: true, avatarInitials: true } },
      },
    });

    // Update new project metrics if task is in a project
    if (newProjectId) {
      const allTasks = await tx.task.findMany({
        where: { projectId: newProjectId },
        select: { status: true },
      });
      const totalCount = allTasks.length;
      const doneCount = allTasks.filter((t) => t.status === "DONE").length;
      const openTasksCount = totalCount - doneCount;
      const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

      await tx.project.update({
        where: { id: newProjectId },
        data: { openTasksCount, progress },
      });

      if (status && status !== existingTask.status) {
        const actionLabel = status === "DONE"
          ? `Completed task: ${updated.title}`
          : `Reopened task: ${updated.title}`;

        await tx.projectActivity.create({
          data: {
            organizationId: session.organizationId,
            projectId: newProjectId,
            authorId: session.userId,
            action: actionLabel,
            type: "task",
          },
        });
      }
    }

    // If project changed, also recompute old project metrics
    if (oldProjectId && oldProjectId !== newProjectId) {
      const allOldTasks = await tx.task.findMany({
        where: { projectId: oldProjectId },
        select: { status: true },
      });
      const totalOld = allOldTasks.length;
      const doneOld = allOldTasks.filter((t) => t.status === "DONE").length;
      await tx.project.update({
        where: { id: oldProjectId },
        data: {
          openTasksCount: totalOld - doneOld,
          progress: totalOld > 0 ? Math.round((doneOld / totalOld) * 100) : 0,
        },
      });
    }

    return updated;
  });

  // Invalidate cache immediately so dashboard reflects updated open/completed counts
  invalidateDashboardCache(session.organizationId);

  const { notifyOrgDataChanged } = await import("@/app/lib/data-sync");
  await notifyOrgDataChanged(session.organizationId, ["tasks", "projects"]);

  const meta = parseTaskMetadata(updatedTask);

  let sourceInsight = null;
  if (meta.insightId) {
    sourceInsight = await prisma.insight.findFirst({
      where: { id: meta.insightId, organizationId: session.organizationId },
      select: { id: true, title: true, type: true, severity: true },
    });
  }

  const formatted: TaskDto = {
    id: updatedTask.id,
    title: updatedTask.title,
    cleanTitle: meta.cleanTitle,
    description: meta.cleanDescription,
    status: updatedTask.status as TaskStatus,
    priority: meta.priority,
    dueDate: updatedTask.dueDate ? updatedTask.dueDate.toISOString() : null,
    createdAt: updatedTask.createdAt.toISOString(),
    updatedAt: updatedTask.updatedAt.toISOString(),
    projectId: updatedTask.projectId,
    project: updatedTask.project,
    assignee: updatedTask.assignee,
    sourceInsight,
  };

  return Response.json({ task: formatted });
}

/**
 * DELETE /api/tasks/:id
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  if (!taskId) {
    return Response.json({ error: "Task ID is required" }, { status: 400 });
  }

  const existingTask = await prisma.task.findFirst({
    where: { id: taskId, organizationId: session.organizationId },
    select: { id: true, projectId: true },
  });

  if (!existingTask) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.delete({
      where: { id: taskId },
    });

    if (existingTask.projectId) {
      const allTasks = await tx.task.findMany({
        where: { projectId: existingTask.projectId },
        select: { status: true },
      });
      const totalCount = allTasks.length;
      const doneCount = allTasks.filter((t) => t.status === "DONE").length;
      await tx.project.update({
        where: { id: existingTask.projectId },
        data: {
          openTasksCount: totalCount - doneCount,
          progress: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
        },
      });
    }
  });

  // Invalidate cache immediately so dashboard reflects updated counts
  invalidateDashboardCache(session.organizationId);

  const { notifyOrgDataChanged } = await import("@/app/lib/data-sync");
  await notifyOrgDataChanged(session.organizationId, ["tasks", "projects"]);

  return Response.json({ success: true });
}
