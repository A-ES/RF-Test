import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/customer-conversations/[id]/read">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const conversation = await prisma.customerConversation.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });

  if (!conversation) return json({ error: "Conversation not found" }, 404);

  const now = new Date();
  await prisma.conversationRead.upsert({
    where: {
      conversationId_userId: {
        conversationId: id,
        userId: session.userId,
      },
    },
    update: { lastReadAt: now },
    create: {
      organizationId: session.organizationId,
      conversationId: id,
      userId: session.userId,
      lastReadAt: now,
    },
  });

  return json({ success: true, readAt: now.toISOString() });
}
