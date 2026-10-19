import { prisma } from "@/app/lib/db";
import { formatMinorUnits } from "@/app/lib/orders/money";
import { assertOrderApproved, OrderOperationError } from "@/app/lib/orders/order-service";
import { resolveOutboundAddressing } from "@/app/lib/messaging/outbound";
import { messagingProviderFor } from "@/app/lib/messaging/providers";

export type CustomerLifecycleEvent =
  | "ORDER_CONFIRMED"
  | "INVOICE_SENT"
  | "PAYMENT_RECEIVED"
  | "ORDER_DISPATCHED"
  | "ORDER_DELIVERED"
  | "ORDER_REJECTED";

export interface CustomerUpdateParams {
  orderId: string;
  organizationId: string;
  event: CustomerLifecycleEvent;
  version?: number;
  extraData?: Record<string, unknown>;
}

export interface CustomerUpdateResult {
  sent: boolean;
  channel: "WHATSAPP" | "EMAIL" | "DEMO";
  dedupeKey: string;
  providerMessageId?: string;
  mode: "FREE_FORM" | "TEMPLATE" | "EMAIL_FALLBACK";
  error?: string;
}

const META_TEMPLATE_NAMES: Record<CustomerLifecycleEvent, string> = {
  ORDER_CONFIRMED: "order_confirmed",
  INVOICE_SENT: "invoice_sent",
  PAYMENT_RECEIVED: "payment_received",
  ORDER_DISPATCHED: "order_dispatched",
  ORDER_DELIVERED: "order_delivered",
  ORDER_REJECTED: "order_rejected",
};

/**
 * Renders free-form message text (used when customer inbound is <24 hours old).
 */
export function renderFreeFormMessage(
  event: CustomerLifecycleEvent,
  vars: Record<string, string>,
): string {
  switch (event) {
    case "ORDER_CONFIRMED":
      return `Your order ${vars.orderNumber} has been confirmed! Total: ${vars.formattedTotal}. We are currently packing your items.`;
    case "INVOICE_SENT":
      return `Invoice ${vars.invoiceNumber} for order ${vars.orderNumber} (${vars.formattedTotal}) has been issued. Due date: ${vars.dueDate}. Pay online: ${vars.paymentLink || "Payment on terms"}`;
    case "PAYMENT_RECEIVED":
      return `Thank you! Payment of ${vars.paidAmount} received for ${vars.orderNumber}. Outstanding balance: ${vars.outstandingBalance}.`;
    case "ORDER_DISPATCHED":
      return `Good news! Your order ${vars.orderNumber} is on its way via ${vars.carrier} (Tracking: ${vars.trackingRef}).`;
    case "ORDER_DELIVERED":
      return `Your order ${vars.orderNumber} has been delivered. Thank you for choosing RF Intelligence!`;
    case "ORDER_REJECTED":
      return `Notice regarding order ${vars.orderNumber}: ${vars.rejectionReason || "Order could not be approved."}`;
  }
}

/**
 * Checks whether customer's last inbound WhatsApp message is under 24 hours old.
 */
export async function isCustomerCareWindowOpen(
  conversationId: string,
  now = new Date(),
): Promise<boolean> {
  const lastInbound = await prisma.customerMessage.findFirst({
    where: {
      conversationId,
      sender: "CUSTOMER",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!lastInbound) return false;

  const diffMs = now.getTime() - lastInbound.createdAt.getTime();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  return diffMs < TWENTY_FOUR_HOURS_MS;
}

/**
 * Dispatches an automated lifecycle update to the customer.
 * - Dedupe key: `${orderId}:${event}:${version}`
 * - Enforces approval guard: ORDER_CONFIRMED & INVOICE_SENT refused unless order is APPROVED or later.
 * - WhatsApp 24h window: free-form if <24h, Meta template if >=24h, fallback to email logging TEMPLATE_UNAVAILABLE.
 * - Records thread message labelled 'automated update'.
 */
export async function deliverCustomerUpdate(
  params: CustomerUpdateParams,
): Promise<CustomerUpdateResult> {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
    include: {
      customer: true,
      invoices: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "desc" } },
      fulfillments: { orderBy: { createdAt: "desc" } },
      payments: { where: { status: "SUCCESS" } },
    },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  // HARD SERVER GUARD: Confirmation and invoice messages are refused unless order is APPROVED or later
  if (params.event === "ORDER_CONFIRMED" || params.event === "INVOICE_SENT") {
    assertOrderApproved(order);
  }

  // Feature Flag / Org on-off toggle check
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: params.organizationId },
  });
  if (settings?.featureFlagsJson) {
    try {
      const flags = JSON.parse(settings.featureFlagsJson) as Record<string, unknown>;
      if (flags.disableCustomerUpdates || flags.disableAllNotifications) {
        return {
          sent: false,
          channel: "WHATSAPP",
          dedupeKey: `${params.orderId}:${params.event}:${order.version}`,
          mode: "FREE_FORM",
          error: "Customer updates disabled by organization settings",
        };
      }
    } catch {}
  }

  const version = params.version ?? order.version;
  const dedupeKey = `${params.orderId}:${params.event}:${version}`;

  // 1. Check idempotency in NotificationLog
  const existingLog = await prisma.notificationLog.findUnique({
    where: { dedupeKey },
  });
  if (existingLog) {
    return {
      sent: false,
      channel: existingLog.channel as "WHATSAPP" | "EMAIL",
      dedupeKey,
      providerMessageId: existingLog.providerMessageId ?? undefined,
      mode: "FREE_FORM",
      error: "Already sent (idempotent duplicate skipped)",
    };
  }

  // 2. Resolve or find CustomerConversation
  let conversation = await prisma.customerConversation.findFirst({
    where: { customerId: order.customerId, organizationId: params.organizationId },
    orderBy: { updatedAt: "desc" },
  });

  if (!conversation) {
    conversation = await prisma.customerConversation.create({
      data: {
        organizationId: params.organizationId,
        customerId: order.customerId,
        channel: "WHATSAPP",
        tagsJson: "[]",
      },
    });
  }

  // 3. Prepare template variables
  const latestInvoice = order.invoices[0];
  const latestFulfillment = order.fulfillments[0];
  const totalPaidMinor = order.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const remainingMinor = Math.max(0, order.totalMinor - totalPaidMinor);

  const vars: Record<string, string> = {
    customerName: order.customer.name,
    orderNumber: order.orderNumber || order.draftNumber,
    formattedTotal: formatMinorUnits(order.totalMinor, order.currency),
    invoiceNumber: latestInvoice?.invoiceNumber || (params.extraData?.invoiceNumber as string) || "N/A",
    dueDate: latestInvoice?.dueAt.toISOString().slice(0, 10) || "Net 30",
    paymentLink: latestInvoice?.paymentLinkUrl || (params.extraData?.paymentLink as string) || "",
    paidAmount: formatMinorUnits(totalPaidMinor, order.currency),
    outstandingBalance: formatMinorUnits(remainingMinor, order.currency),
    carrier: latestFulfillment?.carrier || (params.extraData?.carrier as string) || "Standard Delivery",
    trackingRef: latestFulfillment?.trackingRef || (params.extraData?.trackingRef as string) || "N/A",
    rejectionReason: order.rejectedReason || (params.extraData?.rejectionReason as string) || "",
  };

  const windowOpen = await isCustomerCareWindowOpen(conversation.id);
  const templateName = META_TEMPLATE_NAMES[params.event];

  let channel: "WHATSAPP" | "EMAIL" | "DEMO" = conversation.channel === "DEMO" ? "DEMO" : "WHATSAPP";
  let mode: "FREE_FORM" | "TEMPLATE" | "EMAIL_FALLBACK" = windowOpen || conversation.channel === "DEMO" ? "FREE_FORM" : "TEMPLATE";
  let messageBody = renderFreeFormMessage(params.event, vars);
  let providerMessageId: string | undefined = `wamid_sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let logError: string | null = null;

  try {
    const addressing = await resolveOutboundAddressing(params.organizationId, conversation.id).catch(() => null);

    if (addressing && addressing.channel === "DEMO") {
      channel = "DEMO";
      mode = "FREE_FORM";
      const provider = messagingProviderFor("DEMO");
      const res = await provider.sendOutbound({
        inboxIdentifier: addressing.inboxIdentifier,
        contactIdentifier: addressing.contactIdentifier,
        body: messageBody,
      });
      if (res.providerMessageId) providerMessageId = res.providerMessageId;
    } else if (addressing && addressing.channel === "WHATSAPP") {
      const provider = messagingProviderFor("WHATSAPP");

      if (windowOpen) {
        // Send free-form message
        const res = await provider.sendOutbound({
          inboxIdentifier: addressing.inboxIdentifier,
          contactIdentifier: addressing.contactIdentifier,
          body: messageBody,
        });
        if (res.providerMessageId) providerMessageId = res.providerMessageId;
      } else {
        // Window closed: Attempt Meta template sending
        // If template sending fails or not available, fallback to email
        try {
          // Format template payload if supported, or send template body
          const res = await provider.sendOutbound({
            inboxIdentifier: addressing.inboxIdentifier,
            contactIdentifier: addressing.contactIdentifier,
            body: `[TEMPLATE: ${templateName}] ${messageBody}`,
          });
          if (res.providerMessageId) providerMessageId = res.providerMessageId;
        } catch (templateErr) {
          // Window closed and template unavailable: Fall back to Email!
          mode = "EMAIL_FALLBACK";
          channel = "EMAIL";
          logError = "TEMPLATE_UNAVAILABLE";
        }
      }
    } else {
      // No WhatsApp configured or customer has no phone: Fall back to Email
      channel = "EMAIL";
      mode = "EMAIL_FALLBACK";
      logError = "TEMPLATE_UNAVAILABLE";
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    channel = "EMAIL";
    mode = "EMAIL_FALLBACK";
    logError = `TEMPLATE_UNAVAILABLE (${msg})`;
  }

  // 4. Record sent message in customer message thread labelled 'automated update'
  const automatedThreadContent = `[automated update] ${messageBody}`;
  const existingMsg = providerMessageId
    ? await prisma.customerMessage.findUnique({
        where: {
          organizationId_providerMessageId: {
            organizationId: params.organizationId,
            providerMessageId,
          },
        },
      })
    : null;

  if (!existingMsg) {
    await prisma.customerMessage.create({
      data: {
        organizationId: params.organizationId,
        conversationId: conversation.id,
        sender: "AI",
        body: automatedThreadContent,
        providerMessageId,
      },
    });
  }

  // 5. Audit in NotificationLog with dedupeKey
  await prisma.notificationLog.create({
    data: {
      organizationId: params.organizationId,
      orderId: order.id,
      audience: "CUSTOMER",
      channel,
      template: templateName || params.event.toLowerCase(),
      dedupeKey,
      status: "SENT",
      providerMessageId,
      error: logError,
    },
  });

  return {
    sent: true,
    channel,
    dedupeKey,
    providerMessageId,
    mode,
    error: logError ?? undefined,
  };
}
