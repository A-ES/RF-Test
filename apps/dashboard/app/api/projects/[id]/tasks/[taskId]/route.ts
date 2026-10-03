import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { PROJECT_SELECT, serializeProject } from "@/app/api/projects/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
type TaskStatus = (typeof VALID_TASK_STATUSES)[number];

interface UpdateTaskBody {
  title?: string;
  status?: TaskStatus;
  assigneeId?: string | null;
  dueDate?: string | null;
}

function isValidIso(s: string): boolean {
  return !isNaN(new Date(s).getTime());
}

// ─── PATCH /api/projects/:id/tasks/:taskId ───────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, taskId } = await params;
  if (!id || !taskId) {
    return Response.json({ error: "Project ID and Task ID are required" }, { status: 400 });
  }

  // 1. Organization scoping: check task & project belong to session's organization
  const existingTask = await prisma.task.findFirst({
    where: { id: taskId, projectId: id, organizationId: session.organizationId },
    select: { id: true, title: true, status: true, assigneeId: true, dueDate: true },
  });

  if (!existingTask) {
    return Response.json({ error: "Task not found in this project" }, { status: 404 });
  }

  let body: UpdateTaskBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, status, assigneeId, dueDate } = body;
  const dataToUpdate: Record<string, unknown> = {};
  let activityAction: string | null = null;
  let activityDetails: string | undefined = undefined;

  if (title !== undefined) {
    if (!title.trim() || title.length > 200) {
      return Response.json({ error: "title cannot be empty (max 200 chars)" }, { status: 422 });
    }
    if (title.trim() !== existingTask.title) {
      dataToUpdate.title = title.trim();
    }
  }

  if (assigneeId !== undefined) {
    if (assigneeId && assigneeId.trim()) {
      const member = await prisma.user.findFirst({
        where: { id: assigneeId.trim(), organizationId: session.organizationId },
        select: { id: true },
      });
      if (!member) {
        return Response.json({ error: "Assignee not found in this organization" }, { status: 422 });
      }
      dataToUpdate.assigneeId = member.id;
    } else {
      dataToUpdate.assigneeId = null;
    }
  }

  if (dueDate !== undefined) {
    if (dueDate) {
      if (!isValidIso(dueDate)) {
        return Response.json(
          { error: "dueDate must be a valid ISO 8601 date-time string" },
          { status: 422 }
        );
      }
      dataToUpdate.dueDate = new Date(dueDate);
    } else {
      dataToUpdate.dueDate = null;
    }
  }

  if (status !== undefined) {
    if (!VALID_TASK_STATUSES.includes(status)) {
      return Response.json(
        { error: `status must be one of: ${VALID_TASK_STATUSES.join(", ")}` },
        { status: 422 }
      );
    }
    if (status !== existingTask.status) {
      dataToUpdate.status = status;
      const targetTitle = (dataToUpdate.title as string) || existingTask.title;
      if (status === "DONE") {
        activityAction = `Marked '${targetTitle}' complete`;
      } else if (existingTask.status === "DONE") {
        activityAction = `Marked '${targetTitle}' incomplete`;
      } else {
        activityAction = `Updated status for '${targetTitle}' to ${status}`;
      }
    }
  }

  // If status didn't trigger activity, check if details updated
  if (!activityAction && Object.keys(dataToUpdate).length > 0) {
    const targetTitle = (dataToUpdate.title as string) || existingTask.title;
    activityAction = `Updated task '${targetTitle}'`;
  }

  const updatedProject = await prisma.$transaction(async (tx) => {
    if (Object.keys(dataToUpdate).length > 0) {
      await tx.task.update({
        where: { id: taskId },
        data: dataToUpdate,
      });
    }

    // Compute updated progress & openTasksCount
    const allTasks = await tx.task.findMany({
      where: { projectId: id },
      select: { status: true },
    });
    const totalCount = allTasks.length;
    const doneCount = allTasks.filter((t) => t.status === "DONE").length;
    const newProgress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const openTasksCount = totalCount - doneCount;

    await tx.project.update({
      where: { id },
      data: {
        progress: newProgress,
        openTasksCount,
      },
    });

    if (activityAction) {
      await tx.projectActivity.create({
        data: {
          organizationId: session.organizationId,
          projectId: id,
          authorId: session.userId,
          action: activityAction,
          details: activityDetails,
          type: "task",
        },
      });
    }

    return tx.project.findUnique({
      where: { id },
      select: PROJECT_SELECT,
    });
  });

  const { invalidateDashboardCache } = await import("@/app/api/dashboard/route");
  invalidateDashboardCache(session.organizationId);

  return Response.json({ project: serializeProject(updatedProject!) });
}

// ─── DELETE /api/projects/:id/tasks/:taskId ──────────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, taskId } = await params;
  if (!id || !taskId) {
    return Response.json({ error: "Project ID and Task ID are required" }, { status: 400 });
  }

  // 1. Organization scoping: check task & project belong to session's organization
  const existingTask = await prisma.task.findFirst({
    where: { id: taskId, projectId: id, organizationId: session.organizationId },
    select: { id: true, title: true },
  });

  if (!existingTask) {
    return Response.json({ error: "Task not found in this project" }, { status: 404 });
  }

  const updatedProject = await prisma.$transaction(async (tx) => {
    // Delete task
    await tx.task.delete({
      where: { id: taskId },
    });

    // Recompute progress & openTasksCount
    const allTasks = await tx.task.findMany({
      where: { projectId: id },
      select: { status: true },
    });
    const totalCount = allTasks.length;
    const doneCount = allTasks.filter((t) => t.status === "DONE").length;
    const newProgress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const openTasksCount = totalCount - doneCount;

    await tx.project.update({
      where: { id },
      data: {
        progress: newProgress,
        openTasksCount,
      },
    });

    // Log activity
    await tx.projectActivity.create({
      data: {
        organizationId: session.organizationId,
        projectId: id,
        authorId: session.userId,
        action: `Deleted task '${existingTask.title}'`,
        type: "task",
      },
    });

    return tx.project.findUnique({
      where: { id },
      select: PROJECT_SELECT,
    });
  });

  const { invalidateDashboardCache } = await import("@/app/api/dashboard/route");
  invalidateDashboardCache(session.organizationId);

  return Response.json({ project: serializeProject(updatedProject!) });
}
