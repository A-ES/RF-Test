import { prisma } from "@/app/lib/db";
import { assertOrderApproved, OrderOperationError } from "@/app/lib/orders/order-service";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";
import { deliverNotifications } from "@/app/lib/notifications";
import { writeAuditLog } from "@/app/lib/audit";
import { deliverCustomerUpdate } from "@/app/lib/messaging/customer-updates";
import { formatMinorUnits } from "@/app/lib/orders/money";
import type { OrderPaymentStatus, PaymentStatus } from "@prisma/client";

export interface ApplyPaymentEventParams {
  orderId: string;
  organizationId?: string;
  provider: string;
  providerPaymentId: string;
  amountMinor: number;
  status: PaymentStatus;
  eventType: string;
  paidAt?: Date;
  rawJson?: string;
  invoiceId?: string;
}

export interface ManualPaymentParams {
  orderId: string;
  organizationId: string;
  amountMinor: number;
  reference: string;
  notes?: string;
  actor: { id: string; role: string; name: string };
}

/**
 * Applies a payment or refund event safely to Payment rows, Invoice, and Order.paymentStatus.
 * Handles partial, over, and out-of-order events atomically.
 * Deduplicates on providerPaymentId.
 */
export async function applyPaymentEvent(params: ApplyPaymentEventParams) {
  // 1. Fetch order
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: {
      invoices: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) {
    throw new OrderOperationError(`Order ${params.orderId} not found`, "NOT_FOUND");
  }

  // Hard server guard
  assertOrderApproved(order);

  const orgId = params.organizationId || order.organizationId;
  const targetInvoice = params.invoiceId
    ? await prisma.invoice.findUnique({ where: { id: params.invoiceId } })
    : order.invoices[0];

  const result = await prisma.$transaction(async (tx) => {
    // 2. Deduplication check on providerPaymentId
    const existingPayment = await tx.payment.findUnique({
      where: { providerPaymentId: params.providerPaymentId },
    });

    let paymentRecord;
    let isReplay = false;

    if (existingPayment) {
      if (existingPayment.status === params.status) {
        // Replayed webhook is a no-op!
        return {
          isReplay: true,
          payment: existingPayment,
          order,
          netPaidMinor: existingPayment.amountMinor,
          newPaymentStatus: order.paymentStatus,
        };
      }
      // Status update on existing payment (e.g. PENDING -> SUCCESS, or SUCCESS -> REFUNDED)
      paymentRecord = await tx.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: params.status,
          amountMinor: params.amountMinor,
          paidAt: params.paidAt ?? new Date(),
          rawJson: params.rawJson ?? existingPayment.rawJson,
        },
      });
    } else {
      paymentRecord = await tx.payment.create({
        data: {
          organizationId: orgId,
          orderId: order.id,
          invoiceId: targetInvoice?.id ?? null,
          provider: params.provider,
          providerPaymentId: params.providerPaymentId,
          amountMinor: params.amountMinor,
          status: params.status,
          paidAt: params.paidAt ?? new Date(),
          rawJson: params.rawJson,
        },
      });
    }

    // 3. Recalculate net payment safely for partial, over, and refund events
    const allPayments = await tx.payment.findMany({
      where: { orderId: order.id },
    });

    const successfulMinor = allPayments
      .filter((p) => p.status === "SUCCESS")
      .reduce((sum, p) => sum + p.amountMinor, 0);

    const refundedMinor = allPayments
      .filter((p) => p.status === "REFUNDED")
      .reduce((sum, p) => sum + p.amountMinor, 0);

    const netPaidMinor = Math.max(0, successfulMinor - refundedMinor);

    let nextPaymentStatus: OrderPaymentStatus = "UNPAID";
    if (netPaidMinor === 0) {
      nextPaymentStatus = refundedMinor > 0 ? "REFUNDED" : "UNPAID";
    } else if (netPaidMinor < order.totalMinor) {
      nextPaymentStatus = "PARTIAL";
    } else {
      // Handles exact and over-payments safely!
      nextPaymentStatus = "PAID";
    }

    // 4. Update Order
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: nextPaymentStatus,
      },
    });

    // 5. Update Invoice status if applicable
    if (targetInvoice) {
      if (nextPaymentStatus === "PAID" || netPaidMinor >= targetInvoice.totalMinor) {
        await tx.invoice.update({
          where: { id: targetInvoice.id },
          data: { status: "PAID" },
        });
      } else if (targetInvoice.status === "PAID") {
        await tx.invoice.update({
          where: { id: targetInvoice.id },
          data: { status: "SENT" },
        });
      }
    }

    // 6. Record OrderEvent
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        organizationId: orgId,
        actorKind: "SYSTEM",
        type: `PAYMENT_${params.status}`,
        fromStatus: order.status,
        toStatus: order.status,
        payloadJson: JSON.stringify({
          provider: params.provider,
          providerPaymentId: params.providerPaymentId,
          amountMinor: params.amountMinor,
          netPaidMinor,
          newPaymentStatus: nextPaymentStatus,
          eventType: params.eventType,
        }),
      },
    });

    return {
      isReplay,
      payment: paymentRecord,
      order: updatedOrder,
      netPaidMinor,
      newPaymentStatus: nextPaymentStatus,
    };
  });

  if (result.isReplay) {
    return result;
  }

  // 7. Post-transaction alerts & side effects
  // Realtime broadcast to Ably
  await publishToChannel(orgChannel(orgId, "orders"), "order.paymentUpdated", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    paymentStatus: result.newPaymentStatus,
    amountMinor: params.amountMinor,
    provider: params.provider,
    providerPaymentId: params.providerPaymentId,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  await publishToChannel(orgChannel(orgId, "orders"), REALTIME_EVENTS.orderUpdated, {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: result.newPaymentStatus,
    eventType: `PAYMENT_${params.status}`,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  // Alert client team members
  const admins = await prisma.user.findMany({
    where: { organizationId: orgId, role: { in: ["ADMIN", "CLIENT_ADMIN", "CLIENT_EMPLOYEE"] } },
    select: { id: true },
  });

  const formattedAmount = formatMinorUnits(params.amountMinor, order.currency);
  await deliverNotifications({
    organizationId: orgId,
    recipientIds: admins.map((a) => a.id),
    title: `Payment Updated: ${order.orderNumber || order.draftNumber}`,
    body: `${params.provider} payment of ${formattedAmount} marked ${params.status}. Status: ${result.newPaymentStatus}`,
    type: "GENERAL",
    linkHref: `/orders/${order.id}`,
    category: "emailAlerts",
  }).catch(() => {});

  // Customer notification on successful payment capture
  if (params.status === "SUCCESS") {
    await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: orgId,
      event: "PAYMENT_RECEIVED",
    }).catch((err) => console.warn("Failed to deliver PAYMENT_RECEIVED customer update:", err));
  }

  return result;
}

/**
 * Manual payment entry by administrator.
 */
export async function recordManualPayment(params: ManualPaymentParams) {
  if (params.amountMinor <= 0) {
    throw new OrderOperationError("Payment amount must be greater than zero", "INVALID_AMOUNT");
  }

  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  assertOrderApproved(order);

  const providerPaymentId = params.reference?.trim() || `manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const result = await applyPaymentEvent({
    orderId: order.id,
    organizationId: params.organizationId,
    provider: "MANUAL",
    providerPaymentId,
    amountMinor: params.amountMinor,
    status: "SUCCESS",
    eventType: "manual.entry",
    paidAt: new Date(),
    rawJson: JSON.stringify({
      recordedBy: params.actor,
      notes: params.notes,
    }),
  });

  await writeAuditLog({
    organizationId: params.organizationId,
    userId: params.actor.id,
    action: "payment.manual_entry",
    entityType: "Payment",
    entityId: result.payment.id,
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      amountMinor: params.amountMinor,
      reference: providerPaymentId,
      notes: params.notes,
    },
  });

  return result;
}
