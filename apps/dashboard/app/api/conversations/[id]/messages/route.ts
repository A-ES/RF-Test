import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { serializeMessage } from "@/app/lib/conversations";
import { deliverNotifications } from "@/app/lib/notifications";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";
import { publishToChannel } from "@/app/lib/realtime/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 4000;
const NOTIFICATION_BODY_LENGTH = 140;

const senderSelect = {
  name: true,
  avatarInitials: true,
  role: true,
  isRFTeam: true,
} as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/conversations/[id]/messages">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId: session.organizationId },
    select: {
      id: true,
      topic: true,
      contextLabel: true,
      rfLead: true,
      unread: true,
    },
  });
  if (!conversation) return json({ error: "Conversation not found" }, 404);

  const messages = await prisma.message.findMany({
    where: { conversationId: id, organizationId: session.organizationId },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: senderSelect } },
  });

  return json({
    conversation,
    messages: messages.map(serializeMessage),
  });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/conversations/[id]/messages">,
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
  const content =
    typeof body.content === "string" ? body.content.trim() : "";

  if (!content) return json({ error: "A message body is required" }, 400);
  if (content.length > MAX_MESSAGE_LENGTH) {
    return json(
      { error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` },
      400,
    );
  }

  // Resolve the conversation and the author together — both only depend on the
  // session and route params.
  const [conversation, sender] = await Promise.all([
    prisma.conversation.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { id: true, topic: true },
    }),
    prisma.user.findFirst({
      where: { id: session.userId, organizationId: session.organizationId },
      select: { id: true, isRFTeam: true },
    }),
  ]);
  if (!conversation) return json({ error: "Conversation not found" }, 404);
  if (!sender) return json({ error: "Unauthorized" }, 401);

  // Persisting the message and flagging the thread are independent writes.
  const [message] = await Promise.all([
    prisma.message.create({
      data: {
        organizationId: session.organizationId,
        conversationId: conversation.id,
        senderId: sender.id,
        isRFTeam: sender.isRFTeam,
        content,
      },
      include: { sender: { select: senderSelect } },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { unread: true },
    }),
  ]);

  // Notify the other side of the thread (and always the RF Operations team for
  // client-authored messages). Delivery respects each recipient's preferences.
  const [priorSenders, rfTeam] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        organizationId: session.organizationId,
      },
      select: { senderId: true },
      distinct: ["senderId"],
    }),
    sender.isRFTeam
      ? Promise.resolve<Array<{ id: string }>>([])
      : prisma.user.findMany({
          where: { organizationId: session.organizationId, isRFTeam: true },
          select: { id: true },
        }),
  ]);

  const recipientIds = new Set(priorSenders.map((row) => row.senderId));
  recipientIds.delete(sender.id);
  for (const member of rfTeam) recipientIds.add(member.id);

  await deliverNotifications({
    organizationId: session.organizationId,
    recipientIds: [...recipientIds],
    title: `New message in ${conversation.topic}`,
    body: truncate(content, NOTIFICATION_BODY_LENGTH),
    type: "INTERNAL_MESSAGE",
    linkHref: `/messages?id=${conversation.id}`,
    category: "emailAlerts",
  });

  await publishToChannel(
    orgChannel(session.organizationId, "messages"),
    REALTIME_EVENTS.messageCreated,
    {
      conversationId: conversation.id,
      message: serializeMessage(message),
    },
  );

  return json({ message: serializeMessage(message) }, 201);
}
