import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { orgChannel, REALTIME_EVENTS } from "@/lib/realtime/channels";
import { publishToChannel } from "@/lib/realtime/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 4000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/admin/conversations/[id]/messages">,
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
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const attachmentsInput = Array.isArray(body.attachments) ? body.attachments : [];

  if (!content && attachmentsInput.length === 0) {
    return json({ error: "Message content or attachment is required" }, 400);
  }
  if (content.length > MAX_MESSAGE_LENGTH) {
    return json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` }, 400);
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, organizationId: true, topic: true, status: true },
  });
  if (!conversation) return json({ error: "Conversation not found" }, 404);

  // Find or create RF Operations user representation inside this tenant
  let rfStaffUser = await prisma.user.findFirst({
    where: { organizationId: conversation.organizationId, isRFTeam: true },
  });

  if (!rfStaffUser) {
    rfStaffUser = await prisma.user.create({
      data: {
        organizationId: conversation.organizationId,
        name: auth.session.name || "RF Intelligence Operations",
        email: `ops-${conversation.organizationId}@rfintelligence.ai`,
        role: "ADMIN",
        avatarInitials: "RF",
        isRFTeam: true,
      },
    });
  }

  // Validate attachments
  const validAttachments: Array<{
    fileName: string;
    fileSize: number;
    mimeType: string;
    storageKey: string;
    fileUrl?: string;
  }> = [];

  for (const att of attachmentsInput) {
    if (
      att &&
      typeof att === "object" &&
      typeof (att as Record<string, unknown>).storageKey === "string" &&
      typeof (att as Record<string, unknown>).fileName === "string" &&
      typeof (att as Record<string, unknown>).fileSize === "number" &&
      typeof (att as Record<string, unknown>).mimeType === "string"
    ) {
      const a = att as Record<string, unknown>;
      const storageKey = a.storageKey as string;
      if (!storageKey.startsWith(`org_${conversation.organizationId}/`)) {
        return json({ error: "Invalid attachment storage key" }, 403);
      }
      validAttachments.push({
        fileName: String(a.fileName).slice(0, 255),
        fileSize: Number(a.fileSize),
        mimeType: String(a.mimeType).slice(0, 100),
        storageKey,
        fileUrl: typeof a.fileUrl === "string" ? a.fileUrl : undefined,
      });
    }
  }

  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        senderId: rfStaffUser.id,
        isRFTeam: true,
        content: content || (validAttachments.length > 0 ? "Attached file(s)" : ""),
        messageType: validAttachments.length > 0 ? "ATTACHMENT" : "TEXT",
        attachments: {
          create: validAttachments.map((att) => ({
            organizationId: conversation.organizationId,
            fileName: att.fileName,
            fileSize: att.fileSize,
            mimeType: att.mimeType,
            storageKey: att.storageKey,
            fileUrl: att.fileUrl,
          })),
        },
      },
      include: {
        sender: {
          select: { name: true, avatarInitials: true, role: true, isRFTeam: true },
        },
        attachments: true,
      },
    });

    // Mark unread for client side
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        unread: true,
        status: conversation.status === "RESOLVED" ? "OPEN" : conversation.status,
      },
    });

    return msg;
  });

  // Record Admin Audit Log
  await recordAuditEvent({
    adminId: auth.session.adminId,
    action: "message.sent",
    entityType: "Message",
    entityId: message.id,
    organizationId: conversation.organizationId,
    metadata: {
      conversationId: conversation.id,
      attachmentCount: validAttachments.length,
    },
  }, request);

  // Deliver in-app notification to client organization members
  const orgMembers = await prisma.user.findMany({
    where: { organizationId: conversation.organizationId, isRFTeam: false },
    select: { id: true },
    take: 20,
  });

  if (orgMembers.length > 0) {
    const title = `RF Support reply: ${conversation.topic}`;
    const notifBody = content ? (content.length > 140 ? `${content.slice(0, 139)}…` : content) : "Sent an attachment";
    await prisma.notification.createMany({
      data: orgMembers.map((m) => ({
        organizationId: conversation.organizationId,
        userId: m.id,
        title,
        body: notifBody,
        type: "INTERNAL_MESSAGE",
        linkHref: `/messages?id=${conversation.id}`,
      })),
    });

    // Broadcast realtime notification event
    await publishToChannel(
      orgChannel(conversation.organizationId, "notifications"),
      REALTIME_EVENTS.notificationCreated,
      { title, body: notifBody, linkHref: `/messages?id=${conversation.id}` },
    );
  }

  const serialized = {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: message.sender.name,
    senderInitials: message.sender.avatarInitials,
    senderRole: "RF Operations",
    isRFTeam: true,
    content: message.content,
    messageType: message.messageType,
    attachments: message.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      storageKey: a.storageKey,
      fileUrl: a.fileUrl,
    })),
    createdAt: message.createdAt,
  };

  // Broadcast realtime message event to the client channel
  await publishToChannel(
    orgChannel(conversation.organizationId, "messages"),
    REALTIME_EVENTS.messageCreated,
    {
      conversationId: conversation.id,
      message: serialized,
    },
  );

  return json({ message: serialized }, 201);
}
