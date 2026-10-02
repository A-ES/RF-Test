import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import { orgChannel, REALTIME_EVENTS } from "@/lib/realtime/channels";
import { publishToChannel } from "@/lib/realtime/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("organizationId");
  const statusParam = url.searchParams.get("status");
  const unreadOnly = url.searchParams.get("unread") === "true";

  const whereClause: Record<string, unknown> = {};
  if (orgId) {
    whereClause.organizationId = orgId;
  }
  if (statusParam === "OPEN" || statusParam === "RESOLVED" || statusParam === "CLOSED") {
    whereClause.status = statusParam;
  }
  if (unreadOnly) {
    whereClause.unread = true;
  }

  const conversations = await prisma.conversation.findMany({
    where: whereClause,
    orderBy: { updatedAt: "desc" },
    take: MAX_LIMIT,
    include: {
      organization: {
        select: { id: true, name: true },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true, isRFTeam: true },
      },
      participants: {
        include: {
          user: {
            select: { id: true, name: true, avatarInitials: true, role: true },
          },
        },
      },
      _count: { select: { messages: true } },
    },
  });

  return json({
    conversations: conversations.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      topic: row.topic,
      contextLabel: row.contextLabel,
      rfLead: row.rfLead,
      status: row.status,
      type: row.type,
      unread: row.unread,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastMessageAt: row.messages[0]?.createdAt ?? null,
      lastMessagePreview: row.messages[0]?.content ?? null,
      lastMessageIsRFTeam: row.messages[0]?.isRFTeam ?? false,
      messageCount: row._count.messages,
      participants: row.participants.map((p) => ({
        id: p.id,
        role: p.role,
        user: p.user ? {
          id: p.user.id,
          name: p.user.name,
          avatarInitials: p.user.avatarInitials,
          role: p.user.role,
        } : null,
      })),
    })),
  });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const contextLabel = typeof body.contextLabel === "string" ? body.contextLabel.trim() : "";
  const rfLead = typeof body.rfLead === "string" && body.rfLead.trim() ? body.rfLead.trim() : auth.session.name;
  const initialMessage = typeof body.initialMessage === "string" ? body.initialMessage.trim() : "";

  if (!organizationId) return json({ error: "organizationId is required" }, 400);
  if (!topic) return json({ error: "topic is required" }, 400);
  if (!contextLabel) return json({ error: "contextLabel is required" }, 400);

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true },
  });
  if (!org) return json({ error: "Organization not found" }, 404);

  // Find or create an RF Operations user placeholder in the tenant for message attribution
  let rfStaffUser = await prisma.user.findFirst({
    where: { organizationId, isRFTeam: true },
  });

  if (!rfStaffUser) {
    rfStaffUser = await prisma.user.create({
      data: {
        organizationId,
        name: auth.session.name || "RF Intelligence Operations",
        email: `ops-${organizationId}@rfintelligence.ai`,
        role: "ADMIN",
        avatarInitials: "RF",
        isRFTeam: true,
      },
    });
  }

  const conversation = await prisma.$transaction(async (tx) => {
    const conv = await tx.conversation.create({
      data: {
        organizationId,
        topic,
        contextLabel,
        rfLead,
        type: "TEAM",
        status: "OPEN",
        unread: false,
        participants: {
          create: [
            {
              organizationId,
              userId: rfStaffUser.id,
              role: "RF_STAFF",
              lastReadAt: new Date(),
            },
          ],
        },
      },
    });

    if (initialMessage) {
      await tx.message.create({
        data: {
          organizationId,
          conversationId: conv.id,
          senderId: rfStaffUser.id,
          isRFTeam: true,
          content: initialMessage,
          messageType: "TEXT",
        },
      });
      await tx.conversation.update({
        where: { id: conv.id },
        data: { unread: true },
      });
    }

    return conv;
  });

  await recordAuditEvent({
    adminId: auth.session.adminId,
    action: "conversation.created",
    entityType: "Conversation",
    entityId: conversation.id,
    organizationId,
    metadata: { topic, contextLabel, rfLead },
  }, request);

  await publishToChannel(
    orgChannel(organizationId, "messages"),
    REALTIME_EVENTS.conversationCreated,
    {
      conversation: {
        id: conversation.id,
        topic: conversation.topic,
        contextLabel: conversation.contextLabel,
        rfLead: conversation.rfLead,
        status: conversation.status,
        type: conversation.type,
        unread: true,
        createdAt: conversation.createdAt,
      },
    },
  );

  return json({ conversation }, 201);
}
