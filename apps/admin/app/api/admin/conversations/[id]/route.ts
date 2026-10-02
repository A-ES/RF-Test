import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { orgChannel, REALTIME_EVENTS } from "@/lib/realtime/channels";
import { publishToChannel } from "@/lib/realtime/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/conversations/[id]">,
): Promise<Response> {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      organization: {
        select: { id: true, name: true },
      },
      participants: {
        include: {
          user: {
            select: { id: true, name: true, avatarInitials: true, role: true },
          },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          sender: {
            select: {
              name: true,
              avatarInitials: true,
              role: true,
              isRFTeam: true,
            },
          },
          attachments: true,
        },
      },
    },
  });

  if (!conversation) return json({ error: "Conversation not found" }, 404);

  return json({
    conversation: {
      id: conversation.id,
      organizationId: conversation.organizationId,
      organizationName: conversation.organization.name,
      topic: conversation.topic,
      contextLabel: conversation.contextLabel,
      rfLead: conversation.rfLead,
      status: conversation.status,
      type: conversation.type,
      unread: conversation.unread,
      resolvedAt: conversation.resolvedAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      participants: conversation.participants.map((p) => ({
        id: p.id,
        role: p.role,
        user: p.user ? {
          id: p.user.id,
          name: p.user.name,
          avatarInitials: p.user.avatarInitials,
          role: p.user.role,
        } : null,
      })),
      messages: conversation.messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderName: m.sender.name,
        senderInitials: m.sender.avatarInitials,
        senderRole: m.isRFTeam ? "RF Operations" : (m.sender.role === "ADMIN" ? "Admin" : "Member"),
        isRFTeam: m.isRFTeam,
        content: m.content,
        messageType: m.messageType,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          storageKey: a.storageKey,
          fileUrl: a.fileUrl,
        })),
        createdAt: m.createdAt,
      })),
    },
  });
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/admin/conversations/[id]">,
): Promise<Response> {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;

  const existing = await prisma.conversation.findUnique({
    where: { id },
  });
  if (!existing) return json({ error: "Conversation not found" }, 404);

  const updateData: Record<string, unknown> = {};

  if (typeof body.unread === "boolean") {
    updateData.unread = body.unread;
  }

  if (body.status === "RESOLVED" || body.status === "OPEN" || body.status === "CLOSED") {
    updateData.status = body.status;
    if (body.status === "RESOLVED") {
      updateData.resolvedAt = new Date();
      updateData.resolvedById = auth.session.adminId;
    } else if (body.status === "OPEN") {
      updateData.resolvedAt = null;
      updateData.resolvedById = null;
    }

    await recordAuditEvent({
      adminId: auth.session.adminId,
      action: `conversation.status.${body.status.toLowerCase()}`,
      entityType: "Conversation",
      entityId: id,
      organizationId: existing.organizationId,
      metadata: { previousStatus: existing.status, newStatus: body.status },
    }, request);
  }

  const conversation = await prisma.conversation.update({
    where: { id },
    data: updateData,
  });

  await publishToChannel(
    orgChannel(existing.organizationId, "messages"),
    "conversation:updated",
    {
      conversation: {
        id: conversation.id,
        status: conversation.status,
        unread: conversation.unread,
        resolvedAt: conversation.resolvedAt,
      },
    },
  );

  return json({ conversation });
}
