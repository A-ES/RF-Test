import { prisma } from "@/app/lib/db";
import { deliverNotifications } from "@/app/lib/notifications";
import { parseOrderFromMessage } from "./order-parser";
import { createOrder } from "./order-service";
import { formatMoney } from "./money";

export interface WhatsAppOrderWorkflowResult {
  orderHandled: boolean;
  orderId?: string;
  orderNumber?: string;
  draftNumber?: string;
  replyMessage?: string;
  confidence?: number;
}

/**
 * Core WhatsApp-to-Order pipeline:
 * WhatsApp message -> understand -> product/SKU match -> inventory check -> pricing -> DRAFT order -> admin notification
 *
 * Non-negotiable Rule 1:
 * Order is created as DRAFT / NEEDS_REVIEW.
 * It is NEVER committed, confirmed as final, or inventory deducted without explicit CLIENT_ADMIN / ADMIN approval.
 */
export async function processWhatsAppOrderWorkflow(params: {
  organizationId: string;
  customerId: string;
  conversationId: string;
  messageId: string;
  messageBody: string;
}): Promise<WhatsAppOrderWorkflowResult> {
  const { organizationId, customerId, conversationId, messageId, messageBody } = params;

  // 1. Understand message and match SKUs + check stock + calculate pricing
  const parseResult = await parseOrderFromMessage(organizationId, messageBody);

  if (!parseResult.hasOrderIntent || parseResult.items.length === 0) {
    return { orderHandled: false };
  }

  // 2. Idempotency check: prevent duplicate draft orders for the exact same customer message
  const existingOrder = await prisma.order.findFirst({
    where: {
      organizationId,
      customerId,
      conversationId,
      sourceMessageId: messageId,
    },
  });

  if (existingOrder) {
    const displayNum = existingOrder.orderNumber ?? existingOrder.draftNumber;
    return {
      orderHandled: true,
      orderId: existingOrder.id,
      orderNumber: existingOrder.orderNumber ?? undefined,
      draftNumber: existingOrder.draftNumber,
      replyMessage: `Draft order ${displayNum} for ${formatMoney(existingOrder.totalMinor)} is already pending administrator approval.`,
      confidence: 1.0,
    };
  }

  // 3. Create DRAFT order in NEEDS_REVIEW
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true, company: true },
  });

  const order = await createOrder({
    organizationId,
    customerId,
    conversationId,
    sourceMessageId: messageId,
    items: parseResult.items.map((it) => ({
      productId: it.itemId,
      sku: it.sku,
      name: it.name,
      quantity: it.quantity,
      unitPricePaise: it.unitPricePaise,
    })),
    currency: parseResult.currency,
    status: "NEEDS_REVIEW",
    instructions: `WhatsApp auto-draft from message [msg:${messageId}]. ${parseResult.summary}`,
    actor: {
      type: "AI",
      name: "RF Intelligence WhatsApp Order Bot",
    },
  });

  const displayOrderNum = order.orderNumber ?? order.draftNumber;

  // 4. Notify CLIENT_ADMIN and ADMIN users that an order requires approval
  const admins = await prisma.user.findMany({
    where: {
      organizationId,
      role: { in: ["ADMIN", "CLIENT_ADMIN"] },
    },
    select: { id: true },
  });

  if (admins.length > 0) {
    await deliverNotifications({
      organizationId,
      recipientIds: admins.map((a) => a.id),
      title: `New WhatsApp Order Pending Approval (${displayOrderNum})`,
      body: `${customer?.name ?? "Customer"} ordered ${parseResult.items.length} items (${formatMoney(order.totalMinor)}). Approval required before inventory commitment.`,
      type: "GENERAL",
      linkHref: `/orders?id=${order.id}`,
      category: "emailAlerts",
    });
  }

  // 5. Construct provisional customer message clearly stating approval is pending
  const itemsText = parseResult.items
    .map((it) => `${it.quantity}x ${it.name} (${it.sku})`)
    .join(", ");

  const replyMessage =
    `Thank you! We've generated draft order ${displayOrderNum} for: ${itemsText}. ` +
    `Estimated Total: ${formatMoney(order.totalMinor)}. ` +
    `Our operations team has been notified for administrative approval. You will receive an official confirmation and invoice once approved.`;

  return {
    orderHandled: true,
    orderId: order.id,
    orderNumber: order.orderNumber ?? undefined,
    draftNumber: order.draftNumber,
    replyMessage,
    confidence: parseResult.confidence,
  };
}
