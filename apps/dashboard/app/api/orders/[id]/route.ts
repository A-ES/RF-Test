/**
 * GET /api/orders/:id — Retrieve order detail, lines, flags, events, conversation,
 * invoice, payments, and fulfillment.
 */
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/orders/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const order = await prisma.order.findFirst({
    where: {
      id,
      organizationId: session.organizationId,
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          company: true,
          email: true,
          whatsapp: true,
          phone: true,
          status: true,
        },
      },
      approvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      lines: {
        include: {
          product: {
            include: {
              inventoryLevel: true,
            },
          },
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
      },
      conversation: {
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            take: 50,
          },
        },
      },
      invoices: {
        orderBy: { createdAt: "desc" },
      },
      payments: {
        orderBy: { createdAt: "desc" },
      },
      fulfillments: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!order) {
    return json({ error: "Order not found" }, 404);
  }

  // Also include source message if sourceMessageId is linked
  let sourceMessage = null;
  if (order.sourceMessageId) {
    sourceMessage = await prisma.customerMessage.findFirst({
      where: {
        organizationId: session.organizationId,
        OR: [
          { providerMessageId: order.sourceMessageId },
          { id: order.sourceMessageId },
        ],
      },
    });
  }

  const totalPaidMinor = (order.payments || [])
    .filter((p) => p.status === "SUCCESS")
    .reduce((sum, p) => sum + p.amountMinor, 0);

  const refundedMinor = (order.payments || [])
    .filter((p) => p.status === "REFUNDED")
    .reduce((sum, p) => sum + p.amountMinor, 0);

  const netPaidMinor = Math.max(0, totalPaidMinor - refundedMinor);
  const outstandingBalanceMinor = Math.max(0, order.totalMinor - netPaidMinor);

  return json({
    order: {
      ...order,
      invoice: order.invoices?.[0] ?? null,
      fulfillment: order.fulfillments?.[0] ?? null,
      sourceMessage,
      totalPaidMinor,
      netPaidMinor,
      outstandingBalanceMinor,
    },
  });
}

