import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { serializeConversationSummary } from "@/app/lib/conversations";
import { orgChannel } from "@/app/lib/realtime/channels";
import { publishToChannel } from "@/app/lib/realtime/server";
import { writeAuditLog } from "@/app/lib/audit";
import {
  getCachedConversationDetail,
  setCachedConversationDetail,
  invalidateConversationCaches,
} from "@/app/lib/conversations-cache";
import { invalidateDashboardCache } from "@/app/api/dashboard/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/conversations/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;
  const cacheKey = `${session.organizationId}:${id}`;

  if (process.env.NODE_ENV !== "test") {
    const cached = getCachedConversationDetail<{ conversation: unknown }>(cacheKey);
    if (cached) {
      return json(cached);
    }
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true },
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

  if (!conversation) return json({ error: "Conversation not found" }, 404);

  const payload = { conversation: serializeConversationSummary(conversation) };
  if (process.env.NODE_ENV !== "test") {
    setCachedConversationDetail(cacheKey, payload);
  }

  return json(payload);
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/conversations/[id]">,
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

  const tStart = performance.now();
  const existing = await prisma.conversation.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, status: true },
  });
  console.log(`[PATCH TIMING] findFirst: ${Math.round(performance.now() - tStart)}ms`);
  if (!existing) return json({ error: "Conversation not found" }, 404);

  const updateData: Record<string, unknown> = {};

  let participantPromise: Promise<unknown> | null = null;
  if (typeof body.unread === "boolean") {
    updateData.unread = body.unread;
    if (!body.unread && prisma.conversationParticipant?.upsert) {
      participantPromise = prisma.conversationParticipant
        .upsert({
          where: {
            conversationId_userId: {
              conversationId: id,
              userId: session.userId,
            },
          },
          create: {
            conversationId: id,
            organizationId: session.organizationId,
            userId: session.userId,
            lastReadAt: new Date(),
          },
          update: {
            lastReadAt: new Date(),
          },
        })
        .catch((err) => console.error("Participant lastReadAt update err:", err));
    }
  }

  const statusChanged =
    (body.status === "RESOLVED" || body.status === "OPEN" || body.status === "CLOSED") &&
    body.status !== existing.status;

  if (body.status === "RESOLVED" || body.status === "OPEN" || body.status === "CLOSED") {
    updateData.status = body.status;
    if (body.status === "RESOLVED") {
      updateData.resolvedAt = new Date();
      updateData.resolvedById = session.userId;
    } else if (body.status === "OPEN") {
      updateData.resolvedAt = null;
      updateData.resolvedById = null;
    }
  }

  if (statusChanged) {
    void writeAuditLog({
      organizationId: session.organizationId,
      userId: session.userId,
      action: `conversation.status.${String(body.status).toLowerCase()}`,
      entityType: "Conversation",
      entityId: id,
      metadata: { previousStatus: existing.status, newStatus: body.status },
    }).catch((err) => console.error("Audit log error:", err));
  }

  // Invalidate in-memory caches
  invalidateConversationCaches(session.organizationId, id);
  invalidateDashboardCache(session.organizationId);

  // Execute conversation update
  const tUpdate = performance.now();
  const [conversation] = await Promise.all([
    prisma.conversation.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        topic: true,
        contextLabel: true,
        rfLead: true,
        status: true,
        type: true,
        unread: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    participantPromise,
  ]);
  console.log(`[PATCH TIMING] update: ${Math.round(performance.now() - tUpdate)}ms`);

  const serialized = serializeConversationSummary(conversation as any);

  const tPub = performance.now();
  await publishToChannel(
    orgChannel(session.organizationId, "messages"),
    "conversation:updated",
    { conversation: serialized },
  );
  console.log(`[PATCH TIMING] publish: ${Math.round(performance.now() - tPub)}ms`);

  const tTotal = Math.round(performance.now() - tStart);
  return Response.json(
    { conversation: serialized },
    {
      status: 200,
      headers: {
        "Server-Timing": `findFirst;dur=${Math.round(tUpdate - tStart)},update;dur=${Math.round(tPub - tUpdate)},pub;dur=${Math.round(performance.now() - tPub)},total;dur=${tTotal}`,
      },
    },
  );
}


