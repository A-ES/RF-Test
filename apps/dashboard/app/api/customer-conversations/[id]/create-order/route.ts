/**
 * POST /api/customer-conversations/[id]/create-order
 *
 * Converts a customer conversation into an RF Intelligence draft order with human review.
 * Reuses existing product catalog, pricing rules, tax calculations, and approval workflows.
 * Links the draft order to conversationId and customerId.
 */

import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { writeAuditLog } from "@/app/lib/audit";
import { createOrUpdateDraftOrder } from "@/app/lib/orders/draft";
import { matchOrderLines, type MatchedOrderLine } from "@/app/lib/orders/match";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/customer-conversations/[id]/create-order">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const conversation = await prisma.customerConversation.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      customer: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!conversation) {
    return json({ error: "Conversation not found" }, 404);
  }

  let body: Record<string, any> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  // 1. Resolve order lines from user input or AI extracted context
  let inputLines: Array<{ sku?: string; rawText?: string; quantity?: number }> = [];

  const aiContextRaw = (conversation as any).aiContextJson;
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    inputLines = body.lines;
  } else if (aiContextRaw) {
    try {
      const ai = JSON.parse(aiContextRaw);
      if (Array.isArray(ai.requestedQuantities) && ai.requestedQuantities.length > 0) {
        inputLines = ai.requestedQuantities.map((rq: any) => ({
          rawText: `${rq.quantity} ${rq.unit || "units"} of ${rq.product}`,
          quantity: rq.quantity,
          sku: undefined,
        }));
      }
    } catch {}
  }

  // Fallback to customer's last message if no extracted lines found
  if (inputLines.length === 0) {
    const lastMsg = conversation.messages.find((m) => m.sender === "CUSTOMER");
    inputLines = [
      {
        rawText: lastMsg?.body || conversation.lastMessagePreview || "Order item",
        quantity: 1,
      },
    ];
  }

  // 2. Match lines against real product catalog (never invent SKUs)
  const extractedLines = inputLines.map((l) => ({
    rawText: l.rawText || l.sku || "Order line",
    quantity: typeof l.quantity === "number" && l.quantity > 0 ? l.quantity : 1,
    unit: "PCS",
    requestedSku: l.sku || null,
  }));

  const matchedLines: MatchedOrderLine[] = await matchOrderLines(
    extractedLines,
    session.organizationId,
    prisma as any,
  );

  // 3. Resolve delivery details
  const deliveryDateStr = body.deliveryDate || null;
  const deliveryDate = deliveryDateStr ? new Date(deliveryDateStr) : null;
  const deliveryAddress = body.deliveryAddress || null;
  const instructions = body.instructions || `Created from conversation with ${conversation.customer.name}`;

  // 4. Create the draft order via the canonical order pipeline
  try {
    const draftResult = await createOrUpdateDraftOrder({
      organizationId: session.organizationId,
      customerId: conversation.customerId,
      conversationId: conversation.id,
      sourceMessageId: conversation.messages[0]?.id || null,
      intent: "ORDER_REQUEST",
      extracted: {
        lines: extractedLines,
        deliveryDate: deliveryDateStr,
        deliveryAddress,
        instructions,
        ambiguities: [],
        resolvedDeliveryDate: deliveryDate,
        flags: [],
      },
      matchedLines,
      skipCustomerAck: true,
    });

    // Write audit log
    await writeAuditLog({
      organizationId: session.organizationId,
      userId: session.userId,
      action: "CONVERSATION_CREATE_ORDER",
      entityType: "ORDER",
      entityId: draftResult.order.id,
      metadata: {
        conversationId: conversation.id,
        draftNumber: draftResult.order.draftNumber,
        status: draftResult.order.status,
        totalMinor: draftResult.order.totalMinor,
      },
    });

    // Notify organization via Ably realtime
    try {
      await publishToChannel(
        orgChannel(session.organizationId, "orders"),
        REALTIME_EVENTS.orderCreated,
        {
          orderId: draftResult.order.id,
          draftNumber: draftResult.order.draftNumber,
          conversationId: conversation.id,
          totalMinor: draftResult.order.totalMinor,
        },
      );
    } catch {}

    return json({
      success: true,
      order: draftResult.order,
      message: `Draft order ${draftResult.order.draftNumber} created successfully from conversation.`,
    }, 201);
  } catch (err: any) {
    console.error("[create-order-from-conversation] Error creating draft order:", err);
    return json({
      error: err.message || "Failed to create draft order from conversation",
    }, 500);
  }
}
