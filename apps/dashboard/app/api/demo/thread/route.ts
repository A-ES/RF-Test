import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { isDemoChannelEnabled } from "@/app/lib/demo-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(request: Request): Promise<Response> {
  if (!isDemoChannelEnabled()) {
    return json({ error: "Not Found" }, 404);
  }

  const session = await getSession();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (session.role !== "CLIENT_ADMIN" && session.role !== "ADMIN") {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const conversationId = url.searchParams.get("conversationId");

  let conversation;

  if (conversationId) {
    conversation = await prisma.customerConversation.findFirst({
      where: {
        id: conversationId,
        organizationId: session.organizationId,
        channel: "DEMO",
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            whatsapp: true,
            email: true,
            company: true,
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
        },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            draftNumber: true,
            orderNumber: true,
            status: true,
            totalMinor: true,
            currency: true,
            createdAt: true,
          },
        },
      },
    });
  } else if (customerId) {
    conversation = await prisma.customerConversation.findFirst({
      where: {
        customerId,
        organizationId: session.organizationId,
        channel: "DEMO",
      },
      orderBy: { updatedAt: "desc" },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            whatsapp: true,
            email: true,
            company: true,
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
        },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            draftNumber: true,
            orderNumber: true,
            status: true,
            totalMinor: true,
            currency: true,
            createdAt: true,
          },
        },
      },
    });
  } else {
    // Find the most recently updated DEMO conversation
    conversation = await prisma.customerConversation.findFirst({
      where: {
        organizationId: session.organizationId,
        channel: "DEMO",
      },
      orderBy: { updatedAt: "desc" },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            whatsapp: true,
            email: true,
            company: true,
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
        },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            draftNumber: true,
            orderNumber: true,
            status: true,
            totalMinor: true,
            currency: true,
            createdAt: true,
          },
        },
      },
    });
  }

  const targetCustomerId = customerId || conversation?.customerId;
  let orders = conversation?.orders ?? [];
  if (orders.length === 0 && targetCustomerId) {
    orders = await prisma.order.findMany({
      where: {
        customerId: targetCustomerId,
        organizationId: session.organizationId,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        draftNumber: true,
        orderNumber: true,
        status: true,
        totalMinor: true,
        currency: true,
        createdAt: true,
      },
    });
  }

  return json({
    conversation: conversation ?? null,
    messages: conversation?.messages ?? [],
    orders,
    customer: conversation?.customer ?? null,
  });
}

