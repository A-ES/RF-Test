import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { isDemoChannelEnabled } from "@/app/lib/demo-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(): Promise<Response> {
  // 1. Env flag check: when false every demo route returns 404
  if (!isDemoChannelEnabled()) {
    return json({ error: "Not Found" }, 404);
  }

  // 2. Auth: session-authenticated, CLIENT_ADMIN or ADMIN only
  const session = await getSession();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (session.role !== "CLIENT_ADMIN" && session.role !== "ADMIN") {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  const organizationId = session.organizationId;

  // 3. Find DEMO conversations for this organization
  const demoConversations = await prisma.customerConversation.findMany({
    where: {
      organizationId,
      channel: "DEMO",
    },
    select: { id: true, customerId: true },
  });

  const demoConvIds = demoConversations.map((c) => c.id);

  // 4. Find demo orders (orders linked to demo conversations or demo customers)
  const demoOrders = await prisma.order.findMany({
    where: {
      organizationId,
      OR: [
        { conversationId: { in: demoConvIds } },
        { customer: { tagsJson: { contains: "demo" } } },
      ],
    },
    select: { id: true },
  });

  const orderIds = demoOrders.map((o) => o.id);

  // Clean up order dependencies first
  if (orderIds.length > 0) {
    await prisma.notificationLog.deleteMany({
      where: { organizationId, orderId: { in: orderIds } },
    });
    await prisma.orderEvent.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.orderLine.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.fulfillment.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.payment.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.invoice.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.order.deleteMany({
      where: { id: { in: orderIds } },
    });
  }

  // 5. Delete DEMO messages and conversations
  let deletedMessagesCount = 0;
  let deletedConversationsCount = 0;

  if (demoConvIds.length > 0) {
    const msgRes = await prisma.customerMessage.deleteMany({
      where: {
        organizationId,
        conversationId: { in: demoConvIds },
      },
    });
    deletedMessagesCount = msgRes.count;

    const convRes = await prisma.customerConversation.deleteMany({
      where: {
        organizationId,
        id: { in: demoConvIds },
      },
    });
    deletedConversationsCount = convRes.count;
  }

  // 6. Delete demo customers (customers created via demo or with "demo" tag)
  const demoCustomers = await prisma.customer.findMany({
    where: {
      organizationId,
      OR: [
        { tagsJson: { contains: "demo" } },
        { name: { startsWith: "Demo " } },
      ],
    },
    select: { id: true },
  });

  const demoCustomerIds = demoCustomers.map((c) => c.id);
  let deletedCustomersCount = 0;

  if (demoCustomerIds.length > 0) {
    // Only delete customers who have no remaining orders
    const remainingOrders = await prisma.order.findMany({
      where: {
        organizationId,
        customerId: { in: demoCustomerIds },
      },
      select: { customerId: true },
    });
    const customerIdsWithRemainingOrders = new Set(remainingOrders.map((o) => o.customerId));
    const safeCustomerIdsToDelete = demoCustomerIds.filter(
      (id) => !customerIdsWithRemainingOrders.has(id),
    );

    if (safeCustomerIdsToDelete.length > 0) {
      const custRes = await prisma.customer.deleteMany({
        where: {
          organizationId,
          id: { in: safeCustomerIdsToDelete },
        },
      });
      deletedCustomersCount = custRes.count;
    }
  }

  return json({
    success: true,
    deleted: {
      orders: orderIds.length,
      conversations: deletedConversationsCount,
      messages: deletedMessagesCount,
      customers: deletedCustomersCount,
    },
  });
}
