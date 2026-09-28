/**
 * GET  /api/customer-conversations/:id  — conversation header + full message thread
 * PATCH /api/customer-conversations/:id — update status / assignment
 *
 * Authorization
 * ─────────────
 * CLIENT_ADMIN  : any conversation in their org
 * CLIENT_EMPLOYEE : only conversations assigned to them
 * ADMIN / MEMBER  : same access as CLIENT_ADMIN (internal team)
 */
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { writeAuditLog } from "@/app/lib/audit";
import type {
  CustomerConversationStatus,
  CustomerConversationPriority,
} from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

// ── helpers ──────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set<CustomerConversationStatus>([
  "OPEN",
  "AI_HANDLING",
  "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_CLIENT",
  "HUMAN_ESCALATION",
  "RESOLVED",
  "CLOSED",
]);

const VALID_PRIORITIES = new Set<CustomerConversationPriority>([
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);

function canAccess(
  session: { role: string; userId: string },
  assignedEmployeeId: string | null,
): boolean {
  if (session.role === "CLIENT_EMPLOYEE") {
    return assignedEmployeeId === session.userId;
  }
  return true; // CLIENT_ADMIN, ADMIN, MEMBER
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/customer-conversations/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const conversation = await prisma.customerConversation.findFirst({
    where: { id, organizationId: session.organizationId },
    select: {
      id: true,
      channel: true,
      status: true,
      priority: true,
      subject: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      escalationReason: true,
      resolvedAt: true,
      closedAt: true,
      assignedEmployeeId: true,
      assignedEmployee: { select: { id: true, name: true } },
      customer: {
        select: {
          id: true,
          name: true,
          company: true,
          email: true,
          phone: true,
          whatsapp: true,
          status: true,
          internalNotes: true,
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sender: true,
          body: true,
          confidenceScore: true,
          providerMessageId: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) return json({ error: "Conversation not found" }, 404);

  if (!canAccess(session, conversation.assignedEmployeeId)) {
    return json({ error: "Forbidden" }, 403);
  }

  return json({ conversation });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/customer-conversations/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;

  const existing = await prisma.customerConversation.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, assignedEmployeeId: true, status: true },
  });
  if (!existing) return json({ error: "Conversation not found" }, 404);

  if (!canAccess(session, existing.assignedEmployeeId)) {
    return json({ error: "Forbidden" }, 403);
  }

  // Validate optional fields
  const rawStatus = typeof body.status === "string" ? body.status.toUpperCase() : undefined;
  const newStatus =
    rawStatus && VALID_STATUSES.has(rawStatus as CustomerConversationStatus)
      ? (rawStatus as CustomerConversationStatus)
      : undefined;

  const rawPriority =
    typeof body.priority === "string" ? body.priority.toUpperCase() : undefined;
  const newPriority =
    rawPriority && VALID_PRIORITIES.has(rawPriority as CustomerConversationPriority)
      ? (rawPriority as CustomerConversationPriority)
      : undefined;

  if (rawStatus && !newStatus) {
    return json({ error: `Invalid status: ${body.status}` }, 400);
  }
  if (rawPriority && !newPriority) {
    return json({ error: `Invalid priority: ${body.priority}` }, 400);
  }

  const now = new Date();
  const updateData: Record<string, unknown> = {
    ...(newStatus ? { status: newStatus } : {}),
    ...(newPriority ? { priority: newPriority } : {}),
    // Set timestamps when moving to terminal states
    ...(newStatus === "RESOLVED" ? { resolvedAt: now } : {}),
    ...(newStatus === "CLOSED" ? { closedAt: now } : {}),
  };

  if (Object.keys(updateData).length === 0) {
    return json({ error: "No valid fields to update" }, 400);
  }

  const updated = await prisma.customerConversation.update({
    where: { id },
    data: updateData,
    select: { id: true, status: true, priority: true, resolvedAt: true, closedAt: true },
  });

  await writeAuditLog({
    organizationId: session.organizationId,
    userId: session.userId,
    action: "customer_conversation.updated",
    entityType: "CustomerConversation",
    entityId: id,
    metadata: { before: { status: existing.status }, after: updateData },
  });

  const { trackEvent } = await import("@/app/lib/analytics");
  if (newStatus === "HUMAN_ESCALATION") {
    trackEvent("customer_conversation_escalated", { conversationId: id }, { organizationId: session.organizationId, userId: session.userId });
  } else if (newStatus === "RESOLVED") {
    trackEvent("customer_conversation_resolved", { conversationId: id }, { organizationId: session.organizationId, userId: session.userId });
  }

  return json({ conversation: updated });
}
