import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { PROJECT_SELECT, serializeProject } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["ON_TRACK", "AT_RISK", "BLOCKED", "COMPLETED"] as const;
type ProjectStatus = (typeof VALID_STATUSES)[number];

interface UpdateProjectBody {
  name?: string;
  accountName?: string;
  ownerId?: string;
  status?: ProjectStatus;
  dueDate?: string;
}

function isValidIso(s: string): boolean {
  return !isNaN(new Date(s).getTime());
}

export async function GET(
  _request: Request,
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

  const project = await prisma.project.findFirst({
    where: { id, organizationId: session.organizationId },
    select: PROJECT_SELECT,
  });

  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  return Response.json({ project: serializeProject(project) });
}

export async function PATCH(
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

  // 1. Organization scoping: check existing project belongs to session's organization
  const existing = await prisma.project.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, name: true, accountName: true, status: true, ownerId: true, dueDate: true },
  });

  if (!existing) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  let body: UpdateProjectBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, accountName, ownerId, status, dueDate } = body;
  const dataToUpdate: Record<string, unknown> = {};
  const changesSummary: string[] = [];

  if (name !== undefined) {
    if (!name.trim() || name.length > 200) {
      return Response.json({ error: "name cannot be empty (max 200 chars)" }, { status: 422 });
    }
    if (name.trim() !== existing.name) {
      dataToUpdate.name = name.trim();
      changesSummary.push(`Name to "${name.trim()}"`);
    }
  }

  if (accountName !== undefined) {
    if (!accountName.trim() || accountName.length > 200) {
      return Response.json({ error: "accountName cannot be empty (max 200 chars)" }, { status: 422 });
    }
    if (accountName.trim() !== existing.accountName) {
      dataToUpdate.accountName = accountName.trim();
      changesSummary.push(`Client to "${accountName.trim()}"`);
    }
  }

  if (ownerId !== undefined) {
    if (!ownerId.trim()) {
      return Response.json({ error: "ownerId cannot be empty" }, { status: 422 });
    }
    if (ownerId !== existing.ownerId) {
      const owner = await prisma.user.findFirst({
        where: { id: ownerId, organizationId: session.organizationId },
        select: { id: true, name: true },
      });
      if (!owner) {
        return Response.json({ error: "Owner not found in this organization" }, { status: 422 });
      }
      dataToUpdate.ownerId = ownerId;
      changesSummary.push(`Owner to ${owner.name}`);
    }
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return Response.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 422 }
      );
    }
    if (status !== existing.status) {
      dataToUpdate.status = status;
      changesSummary.push(`Status to ${status.replace("_", " ")}`);
    }
  }

  if (dueDate !== undefined) {
    if (!dueDate || !isValidIso(dueDate)) {
      return Response.json(
        { error: "dueDate must be a valid ISO 8601 date-time string" },
        { status: 422 }
      );
    }
    const newDueDate = new Date(dueDate);
    if (newDueDate.getTime() !== existing.dueDate.getTime()) {
      dataToUpdate.dueDate = newDueDate;
      changesSummary.push(`Target date to ${newDueDate.toISOString().slice(0, 10)}`);
    }
  }

  // If no fields changed, return existing project directly
  if (Object.keys(dataToUpdate).length === 0) {
    const current = await prisma.project.findUnique({
      where: { id },
      select: PROJECT_SELECT,
    });
    return Response.json({ project: serializeProject(current!) });
  }

  // Perform update and activity log in a transaction
  const updatedProject = await prisma.$transaction(async (tx) => {
    const proj = await tx.project.update({
      where: { id },
      data: dataToUpdate,
      select: PROJECT_SELECT,
    });

    await tx.projectActivity.create({
      data: {
        organizationId: session.organizationId,
        projectId: id,
        authorId: session.userId,
        action: "Updated project details",
        details: changesSummary.join(", "),
        type: "status",
      },
    });

    // Re-fetch project with updated activities
    return tx.project.findUnique({
      where: { id },
      select: PROJECT_SELECT,
    });
  });

  return Response.json({ project: serializeProject(updatedProject!) });
}
