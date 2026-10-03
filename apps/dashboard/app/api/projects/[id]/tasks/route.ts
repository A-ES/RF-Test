import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { PROJECT_SELECT, serializeProject } from "@/app/api/projects/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateTaskBody {
  title: string;
  assigneeId?: string | null;
  dueDate?: string | null;
}

function isValidIso(s: string): boolean {
  return !isNaN(new Date(s).getTime());
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Project ID is required" }, { status: 400 });
  }

  // Organization scoping: verify project exists and belongs to session's organization
  const project = await prisma.project.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, name: true },
  });

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  let body: CreateTaskBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, assigneeId, dueDate } = body;

  if (!title?.trim() || title.length > 200) {
    return Response.json({ error: "title is required (max 200 chars)" }, { status: 422 });
  }

  let verifiedAssigneeId: string | null = null;
  if (assigneeId && assigneeId.trim()) {
    const member = await prisma.user.findFirst({
      where: { id: assigneeId.trim(), organizationId: session.organizationId },
      select: { id: true },
    });
    if (!member) {
      return Response.json({ error: "Assignee not found in this organization" }, { status: 422 });
    }
    verifiedAssigneeId = member.id;
  }

  let parsedDueDate: Date | null = null;
  if (dueDate) {
    if (!isValidIso(dueDate)) {
      return Response.json(
        { error: "dueDate must be a valid ISO 8601 date-time string" },
        { status: 422 }
      );
    }
    parsedDueDate = new Date(dueDate);
  }

  const updatedProject = await prisma.$transaction(async (tx) => {
    // 1. Create task
    const newTask = await tx.task.create({
      data: {
        organizationId: session.organizationId,
        projectId: id,
        title: title.trim(),
        assigneeId: verifiedAssigneeId,
        dueDate: parsedDueDate,
        status: "TODO",
      },
    });

    // 2. Compute updated progress & openTasksCount
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

    // 3. Log activity
    await tx.projectActivity.create({
      data: {
        organizationId: session.organizationId,
        projectId: id,
        authorId: session.userId,
        action: `Added task: ${newTask.title}`,
        type: "task",
      },
    });

    // 4. Return full project
    return tx.project.findUnique({
      where: { id },
      select: PROJECT_SELECT,
    });
  });

  const { invalidateDashboardCache } = await import("@/app/api/dashboard/route");
  invalidateDashboardCache(session.organizationId);

  return Response.json({ project: serializeProject(updatedProject!) }, { status: 201 });
}
