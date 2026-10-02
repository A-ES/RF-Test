import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { serializeConversationSummary } from "@/app/lib/conversations";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";
import { publishToChannel } from "@/app/lib/realtime/server";
import { writeAuditLog } from "@/app/lib/audit";
import {
  getCachedConversationList,
  setCachedConversationList,
  invalidateConversationCaches,
} from "@/app/lib/conversations-cache";
import { invalidateDashboardCache } from "@/app/api/dashboard/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_TOPIC_LENGTH = 160;
const MAX_CONTEXT_LENGTH = 160;
const DEFAULT_RF_LEAD = "RF Intelligence Support";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function parseLimit(raw: string | null): number {
  const parsed = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(parsed)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)))
    : DEFAULT_LIMIT;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const statusParam = url.searchParams.get("status");

  const cacheKey = `${session.organizationId}:${statusParam ?? "ALL"}:${limit}`;
  if (process.env.NODE_ENV !== "test") {
    const cached = getCachedConversationList<{ conversations: unknown }>(cacheKey);
    if (cached) {
      return json(cached);
    }
  }

  const whereClause: Record<string, unknown> = {
    organizationId: session.organizationId,
  };

  if (statusParam === "OPEN" || statusParam === "RESOLVED" || statusParam === "CLOSED") {
    whereClause.status = statusParam;
  }

  const conversations = await prisma.conversation.findMany({
    where: whereClause,
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true },
      },
      participants: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatarInitials: true,
              role: true,
            },
          },
        },
      },
      _count: { select: { messages: true } },
    },
  });

  const payload = {
    conversations: conversations.map(serializeConversationSummary),
  };

  if (process.env.NODE_ENV !== "test") {
    setCachedConversationList(cacheKey, payload);
  }

  return json(payload);
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const contextLabel =
    typeof body.contextLabel === "string" ? body.contextLabel.trim() : "";
  const rfLead =
    typeof body.rfLead === "string" && body.rfLead.trim().length > 0
      ? body.rfLead.trim()
      : DEFAULT_RF_LEAD;
  const type = body.type === "DIRECT" ? "DIRECT" : "TEAM";

  if (!topic) return json({ error: "A topic is required" }, 400);
  if (topic.length > MAX_TOPIC_LENGTH) {
    return json(
      { error: `Topic must be ${MAX_TOPIC_LENGTH} characters or fewer` },
      400,
    );
  }
  if (!contextLabel) return json({ error: "A context label is required" }, 400);
  if (contextLabel.length > MAX_CONTEXT_LENGTH) {
    return json(
      {
        error: `Context label must be ${MAX_CONTEXT_LENGTH} characters or fewer`,
      },
      400,
    );
  }

  const conversation = await prisma.conversation.create({
    data: {
      organizationId: session.organizationId,
      topic,
      contextLabel,
      rfLead,
      type,
      status: "OPEN",
      participants: {
        create: [
          {
            organizationId: session.organizationId,
            userId: session.userId,
            role: "LEAD",
            lastReadAt: new Date(),
          },
        ],
      },
    },
    include: {
      participants: {
        include: {
          user: {
            select: { id: true, name: true, avatarInitials: true, role: true },
          },
        },
      },
      messages: {
        take: 1,
        select: { content: true, createdAt: true },
      },
      _count: { select: { messages: true } },
    },
  });

  // Invalidate conversation list and dashboard caches
  invalidateConversationCaches(session.organizationId, conversation.id);
  invalidateDashboardCache(session.organizationId);

  // Write audit log asynchronously
  void writeAuditLog({
    organizationId: session.organizationId,
    userId: session.userId,
    action: "conversation.created",
    entityType: "Conversation",
    entityId: conversation.id,
    metadata: { topic, contextLabel, type },
  }).catch((err) => console.error("Audit log error:", err));

  const serialized = serializeConversationSummary(conversation);

  await publishToChannel(
    orgChannel(session.organizationId, "messages"),
    REALTIME_EVENTS.conversationCreated,
    {
      conversation: serialized,
    },
  );

  return json({ conversation: serialized }, 201);
}

