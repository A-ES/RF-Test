import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Shared select ────────────────────────────────────────────────────────────

export const PROJECT_SELECT = {
  id: true,
  name: true,
  accountName: true,
  status: true,
  progress: true,
  dueDate: true,
  openTasksCount: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true } },
  tasks: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true } },
    },
  },
  activities: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      action: true,
      details: true,
      type: true,
      createdAt: true,
      author: { select: { id: true, name: true, avatarInitials: true } },
    },
  },
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      fileUrl: true,
      mimeType: true,
      processingStatus: true,
      extractedEntitiesCount: true,
      failureReason: true,
      createdAt: true,
    },
  },
  reports: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      title: true,
      type: true,
      size: true,
      status: true,
      fileUrl: true,
      createdAt: true,
    },
  },
  insights: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      title: true,
      type: true,
      severity: true,
      recommendedAction: true,
      createdAt: true,
    },
  },
} as const;

// ─── GET /api/projects ────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { updatedAt: "desc" },
    select: PROJECT_SELECT,
  });

  return Response.json({ projects: projects.map(serializeProject) });
}

// ─── POST /api/projects ───────────────────────────────────────────────────────

const VALID_STATUSES = ["ON_TRACK", "AT_RISK", "BLOCKED", "COMPLETED"] as const;
type ProjectStatus = (typeof VALID_STATUSES)[number];

interface CreateTaskInput {
  title: string;
  assigneeId?: string;
  dueDate?: string; // ISO 8601
}

interface CreateProjectBody {
  name: string;
  accountName: string;
  ownerId: string;
  status: ProjectStatus;
  dueDate: string; // ISO 8601
  tasks?: CreateTaskInput[];
}

function isValidIso(s: string): boolean {
  return !isNaN(new Date(s).getTime());
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateProjectBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, accountName, ownerId, status, dueDate, tasks: rawTasks } = body;

  if (!name?.trim() || name.length > 200) {
    return Response.json({ error: "name is required (max 200 chars)" }, { status: 422 });
  }
  if (!accountName?.trim() || accountName.length > 200) {
    return Response.json({ error: "accountName is required (max 200 chars)" }, { status: 422 });
  }
  if (!ownerId?.trim()) {
    return Response.json({ error: "ownerId is required" }, { status: 422 });
  }
  if (!VALID_STATUSES.includes(status)) {
    return Response.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 422 });
  }
  if (!dueDate || !isValidIso(dueDate)) {
    return Response.json({ error: "dueDate must be a valid ISO 8601 date-time string" }, { status: 422 });
  }

  // Verify the chosen owner belongs to the same org
  const owner = await prisma.user.findFirst({
    where: { id: ownerId, organizationId: session.organizationId },
    select: { id: true, name: true },
  });
  if (!owner) {
    return Response.json({ error: "Owner not found in this organization" }, { status: 422 });
  }

  // Prepare initial subtasks if supplied
  const validTasks = (rawTasks || [])
    .filter((t) => t.title && t.title.trim())
    .map((t) => ({
      organizationId: session.organizationId,
      title: t.title.trim(),
      assigneeId: t.assigneeId?.trim() || null,
      dueDate: t.dueDate && isValidIso(t.dueDate) ? new Date(t.dueDate) : null,
      status: "TODO" as const,
    }));

  const openTasksCount = validTasks.length;

  const project = await prisma.project.create({
    data: {
      organizationId: session.organizationId,
      ownerId,
      name: name.trim(),
      accountName: accountName.trim(),
      status,
      dueDate: new Date(dueDate),
      progress: 0,
      openTasksCount,
      tasks: validTasks.length > 0 ? { create: validTasks } : undefined,
      activities: {
        create: {
          organizationId: session.organizationId,
          authorId: session.userId,
          action: "Created new project",
          details: validTasks.length > 0 ? `Added ${validTasks.length} initial subtask(s)` : undefined,
          type: "status",
        },
      },
    },
    select: PROJECT_SELECT,
  });

  const { notifyOrgDataChanged } = await import("@/app/lib/data-sync");
  await notifyOrgDataChanged(session.organizationId, ["projects", "alerts"]);

  return Response.json({ project: serializeProject(project) }, { status: 201 });
}

// ─── Serialiser ───────────────────────────────────────────────────────────────

export type ProjectRow = NonNullable<
  Awaited<ReturnType<typeof prisma.project.findFirst<{ select: typeof PROJECT_SELECT }>>>
>;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function serializeProject(p: ProjectRow) {
  const tasks = p.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status as "TODO" | "IN_PROGRESS" | "DONE",
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.name ?? null,
  }));

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "DONE").length;
  const computedProgress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const openTasksCount = totalTasks - doneTasks;

  return {
    id: p.id,
    name: p.name,
    accountName: p.accountName,
    status: p.status,
    progress: computedProgress,
    dueDate: p.dueDate.toISOString(),
    createdAt: (p.createdAt ? new Date(p.createdAt) : new Date()).toISOString(),
    updatedAt: (p.updatedAt ? new Date(p.updatedAt) : new Date()).toISOString(),
    openTasksCount,
    ownerId: p.ownerId,
    ownerName: p.owner.name,
    ownerInitials: getInitials(p.owner.name),
    tasks,
    activities: p.activities.map((a) => ({
      id: a.id,
      timestamp: formatTimestamp(a.createdAt),
      author: a.author.name,
      authorInitials: a.author.avatarInitials ?? getInitials(a.author.name),
      action: a.action,
      details: a.details ?? undefined,
      type: a.type as "status" | "comment" | "task" | "milestone",
    })),
    documents: (p.documents ?? []).map((d) => ({
      id: d.id,
      fileName: d.fileName,
      fileSize: d.fileSize,
      fileUrl: d.fileUrl,
      mimeType: d.mimeType ?? null,
      processingStatus: d.processingStatus as "PENDING" | "PROCESSED" | "FAILED",
      extractedEntitiesCount: d.extractedEntitiesCount,
      failureReason: d.failureReason ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
    reports: (p.reports ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      size: r.size,
      status: r.status as "READY" | "PROCESSING" | "FAILED",
      fileUrl: r.fileUrl ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    insights: (p.insights ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      type: i.type,
      severity: i.severity,
      recommendedAction: i.recommendedAction,
      createdAt: i.createdAt.toISOString(),
    })),
  };
}
