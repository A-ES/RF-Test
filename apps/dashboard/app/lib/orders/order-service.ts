import { prisma } from "@/app/lib/db";
import { writeAuditLog } from "@/app/lib/audit";
import { trackEvent } from "@/app/lib/analytics";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";
import {
  type OrderStatus,
  type OrderActorKind,
  nextNumber,
  formatSequenceNumber,
} from "@rf-intelligence/db";
import { assertOrderApproved } from "./approval";
export { assertOrderApproved } from "./approval";
import { calculateOrderTotals, calculateLineTotalPaise } from "./money";
import { getInventoryProvider } from "@/app/lib/inventory/provider";
import { priceOrder } from "./pricing";
import { loadPricingData } from "./pricing-data";
import { inngest, ORDER_APPROVED_EVENT } from "@/app/lib/inngest/client";

export interface ActorContext {
  id?: string | null;
  type: "USER" | "AI" | "SYSTEM" | "CUSTOMER";
  role?: string | null;
  name?: string | null;
}

export interface CreateOrderLineItemInput {
  productId?: string | null;
  inventoryItemId?: string | null;
  sku: string;
  name: string;
  rawText?: string;
  quantity: number;
  unitPricePaise: number;
}

export interface CreateOrderInput {
  organizationId: string;
  customerId: string;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  items: CreateOrderLineItemInput[];
  currency?: string;
  instructions?: string | null;
  notes?: string | null;
  status?: "DRAFT" | "NEEDS_REVIEW";
  actor: ActorContext;
}

export class OrderOperationError extends Error {
  readonly code: string;
  constructor(message: string, code = "ORDER_OP_FAILED") {
    super(message);
    this.name = "OrderOperationError";
    this.code = code;
  }
}

function mapActorKind(type: ActorContext["type"]): OrderActorKind {
  switch (type) {
    case "USER":
      return "EMPLOYEE";
    case "AI":
      return "AI";
    case "CUSTOMER":
      return "CUSTOMER";
    default:
      return "SYSTEM";
  }
}

export async function recordOrderStateChange(params: {
  orderId: string;
  orderNumber: string | null;
  draftNumber: string;
  organizationId: string;
  actor: ActorContext;
  eventType: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const payloadStr = params.payload ? JSON.stringify(params.payload) : null;
  const actorKind = mapActorKind(params.actor.type);

  // 1. Write OrderEvent (Append-only)
  await prisma.orderEvent.create({
    data: {
      orderId: params.orderId,
      organizationId: params.organizationId,
      actorId: params.actor.id ?? null,
      actorKind,
      type: params.eventType,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      payloadJson: payloadStr,
    },
  });

  // 2. Write AuditLog
  await writeAuditLog({
    organizationId: params.organizationId,
    userId: params.actor.id ?? undefined,
    action: `order.${params.eventType.toLowerCase()}`,
    entityType: "Order",
    entityId: params.orderId,
    metadata: {
      orderNumber: params.orderNumber,
      draftNumber: params.draftNumber,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      actorType: params.actor.type,
      ...(params.payload ?? {}),
    },
  });

  // 3. Track analytics event
  const analyticsAction = `order_${params.eventType.toLowerCase()}` as Parameters<typeof trackEvent>[0];
  try {
    trackEvent(
      analyticsAction,
      {
        orderId: params.orderId,
        orderNumber: params.orderNumber ?? params.draftNumber,
        toStatus: params.toStatus,
      },
      {
        organizationId: params.organizationId,
        userId: params.actor.id ?? undefined,
      },
    );
  } catch {}

  // 4. Publish Realtime event over Ably
  await publishToChannel(
    orgChannel(params.organizationId, "orders"),
    params.eventType === "CREATED" ? REALTIME_EVENTS.orderCreated : REALTIME_EVENTS.orderUpdated,
    {
      orderId: params.orderId,
      orderNumber: params.orderNumber ?? params.draftNumber,
      status: params.toStatus,
      eventType: params.eventType,
      timestamp: new Date().toISOString(),
    },
  );
}

/**
 * Creates a DRAFT or NEEDS_REVIEW order with sequential draftNumber.
 */
export async function createOrder(input: CreateOrderInput) {
  if (!input.items || input.items.length === 0) {
    throw new OrderOperationError("Cannot create order without line items", "EMPTY_ITEMS");
  }

  // Validate items
  const lineItemTotals = input.items.map((it) => {
    const lineTotal = calculateLineTotalPaise(it.quantity, it.unitPricePaise);
    return {
      productId: it.productId ?? null,
      sku: it.sku,
      name: it.name,
      rawText: it.rawText ?? it.name,
      quantity: it.quantity,
      unitPricePaise: it.unitPricePaise,
      totalPricePaise: lineTotal,
    };
  });

  const totals = calculateOrderTotals(
    lineItemTotals.map((it) => ({
      quantity: it.quantity,
      unitPricePaise: it.unitPricePaise,
    })),
  );

  const initialStatus: OrderStatus = input.status ?? "DRAFT";

  // Race-free draft sequence allocation
  const draftNum = await nextNumber(input.organizationId, "DRAFT", prisma);
  const draftNumber = formatSequenceNumber(draftNum, "DFT-", 4);

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        draftNumber,
        orderNumber: null, // null until confirmed / approved
        organizationId: input.organizationId,
        customerId: input.customerId,
        conversationId: input.conversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        status: initialStatus,
        paymentStatus: "UNPAID",
        currency: input.currency ?? "INR",
        subtotalMinor: totals.subtotalPaise,
        taxMinor: totals.taxPaise,
        totalMinor: totals.totalPaise,
        instructions: input.instructions ?? input.notes ?? null,
        lines: {
          create: lineItemTotals.map((item) => ({
            organizationId: input.organizationId,
            productId: item.productId,
            sku: item.sku,
            rawText: item.rawText,
            matchConfidence: 1.0,
            qty: item.quantity,
            unitPriceMinor: item.unitPricePaise,
            lineTotalMinor: item.totalPricePaise,
          })),
        },
      },
      include: {
        lines: true,
        customer: true,
      },
    });

    return created;
  });

  await recordOrderStateChange({
    orderId: order.id,
    orderNumber: order.orderNumber,
    draftNumber: order.draftNumber,
    organizationId: input.organizationId,
    actor: input.actor,
    eventType: "CREATED",
    fromStatus: null,
    toStatus: initialStatus,
    payload: {
      lineCount: order.lines.length,
      totalMinor: order.totalMinor,
      currency: order.currency,
      draftNumber: order.draftNumber,
    },
  });

  return order;
}

/**
 * Transitions order to NEEDS_REVIEW.
 */
export async function submitOrderForApproval(params: {
  orderId: string;
  organizationId: string;
  actor: ActorContext;
}) {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  if (order.status !== "DRAFT") {
    throw new OrderOperationError(
      `Cannot submit order in status ${order.status} for approval`,
      "INVALID_STATE",
    );
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "NEEDS_REVIEW" },
  });

  await recordOrderStateChange({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    draftNumber: updated.draftNumber,
    organizationId: params.organizationId,
    actor: params.actor,
    eventType: "SUBMITTED_FOR_APPROVAL",
    fromStatus: "DRAFT",
    toStatus: "NEEDS_REVIEW",
  });

  return updated;
}

export interface ApproveOrderParams {
  orderId: string;
  organizationId: string;
  approver: {
    id: string;
    role: string;
    name?: string;
  };
  version?: number;
  idempotencyKey?: string | null;
  overrideBlockingFlags?: boolean;
  overrideReason?: string | null;
}

/**
 * Explicit approval of an order by a CLIENT_ADMIN or ADMIN.
 * NON-NEGOTIABLE RULE 1 & 2:
 * Runs in ONE transaction:
 * - Role: CLIENT_ADMIN or ADMIN only
 * - Status: DRAFT | NEEDS_REVIEW
 * - Optimistic concurrency: version must match what admin saw (409 on mismatch)
 * - Re-price and re-check stock (409 with shortages if stock fell)
 * - Blocking flags: prevented unless admin provides an explicit logged overrideReason
 * - Allocates sequential orderNumber from OrgCounter
 * - Reserves stock via InventoryProvider
 * - Creates Fulfillment row (PENDING)
 * - Writes OrderEvents
 * - Idempotency key: retries return same result
 * - After commit: emits order.approved over Ably (customer-facing steps only happen from that event)
 */
export async function approveOrder(params: ApproveOrderParams) {
  const allowedRoles = ["ADMIN", "CLIENT_ADMIN"];
  if (!allowedRoles.includes(params.approver.role)) {
    throw new OrderOperationError(
      `Forbidden: Role ${params.approver.role} is not authorized to approve orders. Only CLIENT_ADMIN or ADMIN may approve.`,
      "FORBIDDEN",
    );
  }

  // 1. Idempotency fast-path
  if (params.idempotencyKey) {
    const existingEvent = await prisma.orderEvent.findFirst({
      where: {
        orderId: params.orderId,
        organizationId: params.organizationId,
        type: "APPROVED",
        payloadJson: { contains: params.idempotencyKey },
      },
    });

    if (existingEvent) {
      const existingOrder = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: {
          lines: true,
          customer: true,
          fulfillments: true,
        },
      });
      if (existingOrder && existingOrder.status === "APPROVED") {
        return existingOrder;
      }
    }
  }

  // 2. Execute approval in ONE atomic transaction
  const result = await prisma.$transaction(async (tx) => {
    // Acquire exclusive row lock in PostgreSQL to serialize concurrent approvals
    if (typeof (tx as any).$queryRaw === "function") {
      try {
        await (tx as any).$queryRaw`SELECT id FROM orders WHERE id = ${params.orderId} FOR UPDATE`;
      } catch {}
    }

    const order = await tx.order.findFirst({
      where: { id: params.orderId, organizationId: params.organizationId },
      include: {
        lines: true,
        customer: true,
      },
    });

    if (!order) {
      throw new OrderOperationError("Order not found", "NOT_FOUND");
    }

    if (order.status === "APPROVED") {
      if (params.idempotencyKey) {
        const event = await tx.orderEvent.findFirst({
          where: {
            orderId: order.id,
            type: "APPROVED",
            payloadJson: { contains: params.idempotencyKey },
          },
        });
        if (event) {
          return { order, orderNumber: order.orderNumber, fromStatus: order.status, isReplay: true };
        }
      }
      throw new OrderOperationError("Order is already approved", "ALREADY_APPROVED");
    }

    if (order.status !== "DRAFT" && order.status !== "NEEDS_REVIEW") {
      throw new OrderOperationError(
        `Cannot approve order in status ${order.status}`,
        "INVALID_STATE",
      );
    }

    // Version check (optimistic concurrency)
    if (params.version !== undefined && order.version !== params.version) {
      throw new OrderOperationError(
        `Stale order version. Expected version ${params.version}, but current version is ${order.version}.`,
        "VERSION_CONFLICT",
      );
    }

    // Blocking flags validation
    let flags: string[] = [];
    try {
      flags = JSON.parse(order.flagsJson || "[]");
    } catch {
      flags = [];
    }

    const blockingFlagTypes = [
      "INSUFFICIENT_STOCK",
      "OUT_OF_STOCK",
      "UNCLEAR_PRODUCT",
      "NO_PRICE",
      "MISSING_DELIVERY_DATE",
      "MISSING_ADDRESS",
      "NEW_CUSTOMER",
    ];
    const activeBlockingFlags = flags.filter((f) =>
      blockingFlagTypes.some((bf) => f === bf || f.startsWith(`${bf}:`)),
    );

    if (activeBlockingFlags.length > 0) {
      if (!params.overrideBlockingFlags || !params.overrideReason?.trim()) {
        throw new OrderOperationError(
          `Cannot approve order with blocking flags (${activeBlockingFlags.join(", ")}) without an admin override reason.`,
          "BLOCKING_FLAGS_PRESENT",
        );
      }
    }

    // Re-check inventory availability
    const inventoryProvider = getInventoryProvider();
    const shortages: Array<{ sku: string; available: number; requested: number }> = [];

    for (const line of order.lines) {
      if (line.productId) {
        const stock = await inventoryProvider.getStock(params.organizationId, line.productId, tx);
        if (stock.available < line.qty) {
          shortages.push({
            sku: line.sku,
            available: stock.available,
            requested: line.qty,
          });
        }
      }
    }

    if (shortages.length > 0) {
      throw new OrderOperationError(
        `Insufficient stock available for line items: ${shortages
          .map((s) => `${s.sku} (available: ${s.available}, required: ${s.requested})`)
          .join("; ")}`,
        "STOCK_SHORTAGE",
      );
    }

    // Re-price with pure priceOrder function
    const productIds = order.lines
      .map((l) => l.productId)
      .filter((id): id is string => Boolean(id));

    const pricingData = await loadPricingData({
      organizationId: params.organizationId,
      customerId: order.customerId,
      productIds,
    });

    const products =
      productIds.length > 0
        ? await tx.product.findMany({
            where: { organizationId: params.organizationId, id: { in: productIds } },
          })
        : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const pricingInput = order.lines.map((l) => {
      const prod = l.productId ? productMap.get(l.productId) : null;
      return {
        productId: l.productId ?? "unknown",
        sku: l.sku,
        qty: l.qty,
        basePriceMinor: prod?.basePriceMinor ?? l.unitPriceMinor ?? 0,
        taxRateBps: prod?.taxRateBps ?? 1800,
      };
    });

    const priced = priceOrder({
      lines: pricingInput,
      customer: order.customerId
        ? {
            id: order.customerId,
            customerPrices: pricingData.customerPrices.map((cp) => ({
              productId: cp.productId,
              priceMinor: cp.priceMinor,
              validFrom: cp.validFrom,
              validTo: cp.validTo,
            })),
          }
        : null,
      rules: pricingData.discountRules.map((dr) => ({
        id: dr.id,
        scope: dr.scope,
        customerId: dr.customerId,
        productId: dr.productId,
        type: dr.type,
        value: dr.value,
        minQty: dr.minQty,
        minOrderMinor: dr.minOrderMinor,
        validFrom: dr.validFrom,
        validTo: dr.validTo,
        priority: dr.priority,
      })),
      taxConfig: { defaultTaxRateBps: 1800 },
      now: new Date(),
    });

    // Allocate race-free sequential orderNumber from OrgCounter
    const orderSeq = await nextNumber(params.organizationId, "ORDER", tx);
    const orderNumber = formatSequenceNumber(orderSeq, "ORD-", 4);
    const now = new Date();

    // Reserve stock via InventoryProvider interface
    for (const line of order.lines) {
      if (line.productId) {
        await inventoryProvider.reserve(params.organizationId, line.productId, line.qty, {
          orderId: order.id,
          actorId: params.approver.id,
          client: tx,
        });
      }
    }

    // Create Fulfillment row in PENDING status
    if (typeof tx.fulfillment?.create === "function") {
      await tx.fulfillment.create({
        data: {
          organizationId: params.organizationId,
          orderId: order.id,
          status: "PENDING",
          notes: `Created on approval (${orderNumber})`,
        },
      });
    }

    // Set APPROVED and update order totals
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        orderNumber,
        status: "APPROVED",
        approvedById: params.approver.id,
        approvedAt: now,
        subtotalMinor: priced.subtotalMinor,
        discountMinor: priced.discountMinor,
        taxMinor: priced.taxMinor,
        totalMinor: priced.totalMinor,
        version: { increment: 1 },
      },
      include: {
        lines: true,
        customer: true,
        fulfillments: true,
      },
    });

    // Write OrderEvent within same transaction
    const eventPayload: Record<string, unknown> = {
      approvedAt: now.toISOString(),
      approverName: params.approver.name,
      approverId: params.approver.id,
      orderNumber,
      idempotencyKey: params.idempotencyKey ?? null,
    };
    if (params.overrideBlockingFlags && params.overrideReason) {
      eventPayload.overrideFlags = activeBlockingFlags;
      eventPayload.overrideReason = params.overrideReason;
    }

    await tx.orderEvent.create({
      data: {
        orderId: updated.id,
        organizationId: params.organizationId,
        actorId: params.approver.id,
        actorKind: "EMPLOYEE",
        type: "APPROVED",
        fromStatus: order.status,
        toStatus: "APPROVED",
        payloadJson: JSON.stringify(eventPayload),
      },
    });

    return {
      order: updated,
      orderNumber,
      fromStatus: order.status,
      eventPayload,
      isReplay: false,
    };
  });

  if (result.isReplay) {
    return result.order;
  }

  // 3. Post-commit side effects: Audit log, Analytics, and emit order.approved
  await writeAuditLog({
    organizationId: params.organizationId,
    userId: params.approver.id,
    action: "order.approved",
    entityType: "Order",
    entityId: result.order.id,
    metadata: {
      orderNumber: result.orderNumber,
      draftNumber: result.order.draftNumber,
      fromStatus: result.fromStatus,
      toStatus: "APPROVED",
      ...(result.eventPayload ?? {}),
    },
  });

  try {
    trackEvent(
      "order_approved" as Parameters<typeof trackEvent>[0],
      {
        orderId: result.order.id,
        orderNumber: result.orderNumber,
        toStatus: "APPROVED",
      },
      {
        organizationId: params.organizationId,
        userId: params.approver.id,
      },
    );
  } catch {}

  // Publish order.approved and realtime update over Ably
  await publishToChannel(
    orgChannel(params.organizationId, "orders"),
    "order.approved",
    {
      orderId: result.order.id,
      orderNumber: result.orderNumber,
      draftNumber: result.order.draftNumber,
      status: "APPROVED",
      approvedById: params.approver.id,
      timestamp: new Date().toISOString(),
    },
  );

  await publishToChannel(
    orgChannel(params.organizationId, "orders"),
    REALTIME_EVENTS.orderUpdated,
    {
      orderId: result.order.id,
      orderNumber: result.orderNumber,
      draftNumber: result.order.draftNumber,
      status: "APPROVED",
      eventType: "APPROVED",
      timestamp: new Date().toISOString(),
    },
  );

  // Dispatch Inngest order.approved event for post-approval orchestration
  try {
    await inngest.send({
      name: ORDER_APPROVED_EVENT,
      data: {
        orderId: result.order.id,
        organizationId: params.organizationId,
        orderNumber: result.orderNumber,
      },
    });
  } catch (inngestErr) {
    console.warn("Inngest order.approved event dispatch error:", inngestErr);
  }

  return result.order;
}

export interface RejectOrderParams {
  orderId: string;
  organizationId: string;
  reason: string;
  actor: ActorContext;
  customerMessageText?: string | null;
  sendCustomerMessage?: boolean;
}

/**
 * Rejects an order with a mandatory reason.
 * Releases reserved inventory if any stock was previously reserved for this order.
 * If no stock was reserved (e.g. DRAFT or NEEDS_REVIEW), releases nothing.
 */
export async function rejectOrder(params: RejectOrderParams) {
  if (params.actor.role && !["ADMIN", "CLIENT_ADMIN"].includes(params.actor.role)) {
    throw new OrderOperationError(
      "Only CLIENT_ADMIN or ADMIN may reject orders",
      "FORBIDDEN",
    );
  }

  if (!params.reason || !params.reason.trim()) {
    throw new OrderOperationError("A reason is required to reject an order", "REASON_REQUIRED");
  }

  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
    include: { lines: true },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  if (order.status === "DELIVERED" || order.status === "CANCELLED" || order.status === "REJECTED") {
    throw new OrderOperationError(
      `Cannot reject order in status ${order.status}`,
      "INVALID_STATE",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Check if reservations were ever recorded for this order
    const hasReservations =
      order.status === "APPROVED" ||
      (await tx.stockMovement.count({
        where: {
          organizationId: params.organizationId,
          orderId: order.id,
          reason: "ORDER_RESERVE",
        },
      })) > 0;

    // Release reservations if previously reserved; otherwise release nothing
    if (hasReservations) {
      const inventoryProvider = getInventoryProvider();
      for (const line of order.lines) {
        if (line.productId) {
          try {
            await inventoryProvider.release(params.organizationId, line.productId, line.qty, {
              orderId: order.id,
              actorId: params.actor.id ?? undefined,
              client: tx,
            });
          } catch {}
        }
      }
    }

    // Optional customer message creation
    if (
      params.sendCustomerMessage &&
      params.customerMessageText?.trim() &&
      order.conversationId
    ) {
      await tx.customerMessage.create({
        data: {
          organizationId: params.organizationId,
          conversationId: order.conversationId,
          sender: "EMPLOYEE",
          body: params.customerMessageText.trim(),
        },
      });
    }

    const rej = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "REJECTED",
        rejectedReason: params.reason.trim(),
        version: { increment: 1 },
      },
      include: { lines: true, customer: true },
    });

    await tx.orderEvent.create({
      data: {
        orderId: rej.id,
        organizationId: params.organizationId,
        actorId: params.actor.id ?? null,
        actorKind: "EMPLOYEE",
        type: "REJECTED",
        fromStatus: order.status,
        toStatus: "REJECTED",
        payloadJson: JSON.stringify({
          reason: params.reason.trim(),
          releasedStock: hasReservations,
          customerMessageSent: Boolean(params.sendCustomerMessage && params.customerMessageText?.trim()),
        }),
      },
    });

    return rej;
  });

  await writeAuditLog({
    organizationId: params.organizationId,
    userId: params.actor.id ?? undefined,
    action: "order.rejected",
    entityType: "Order",
    entityId: updated.id,
    metadata: {
      orderNumber: updated.orderNumber,
      draftNumber: updated.draftNumber,
      fromStatus: order.status,
      toStatus: "REJECTED",
      reason: params.reason.trim(),
    },
  });

  try {
    trackEvent(
      "order_rejected" as Parameters<typeof trackEvent>[0],
      {
        orderId: updated.id,
        orderNumber: updated.orderNumber ?? updated.draftNumber,
        toStatus: "REJECTED",
      },
      {
        organizationId: params.organizationId,
        userId: params.actor.id ?? undefined,
      },
    );
  } catch {}

  await publishToChannel(
    orgChannel(params.organizationId, "orders"),
    REALTIME_EVENTS.orderUpdated,
    {
      orderId: updated.id,
      orderNumber: updated.orderNumber ?? updated.draftNumber,
      status: "REJECTED",
      eventType: "REJECTED",
      timestamp: new Date().toISOString(),
    },
  );

  return updated;
}

/**
 * Creates an official sequential Invoice for an approved order.
 * NON-NEGOTIABLE RULE 1: Enforces assertOrderApproved(order).
 */
export async function invoiceOrder(params: {
  orderId: string;
  organizationId: string;
  actor: ActorContext;
  pdfPath?: string;
  paymentLinkUrl?: string;
}) {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  // ENFORCE SERVER-SIDE APPROVAL GUARD (Rule 1)
  assertOrderApproved(order);

  const invNum = await nextNumber(params.organizationId, "INVOICE", prisma);
  const invoiceNumber = formatSequenceNumber(invNum, "INV-", 4);
  const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Net 30

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: params.organizationId,
      orderId: order.id,
      invoiceNumber,
      status: "SENT",
      dueAt,
      pdfPath: params.pdfPath,
      paymentLinkUrl: params.paymentLinkUrl,
      totalMinor: order.totalMinor,
    },
  });

  await recordOrderStateChange({
    orderId: order.id,
    orderNumber: order.orderNumber,
    draftNumber: order.draftNumber,
    organizationId: params.organizationId,
    actor: params.actor,
    eventType: "INVOICED",
    fromStatus: order.status,
    toStatus: order.status,
    payload: { invoiceNumber, invoiceId: invoice.id },
  });

  return invoice;
}

/**
 * Records payment against an approved order.
 * NON-NEGOTIABLE RULE 1: Enforces assertOrderApproved(order).
 */
export async function recordOrderPayment(params: {
  orderId: string;
  organizationId: string;
  paymentReference: string;
  provider?: string;
  amountMinor?: number;
  actor: ActorContext;
}) {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  // ENFORCE SERVER-SIDE APPROVAL GUARD (Rule 1)
  assertOrderApproved(order);

  const amount = params.amountMinor ?? order.totalMinor;

  const payment = await prisma.$transaction(async (tx) => {
    const pay = await tx.payment.create({
      data: {
        organizationId: params.organizationId,
        orderId: order.id,
        provider: params.provider ?? "MANUAL",
        providerPaymentId: params.paymentReference,
        amountMinor: amount,
        status: "SUCCESS",
        paidAt: new Date(),
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "PAID",
      },
    });

    return pay;
  });

  await recordOrderStateChange({
    orderId: order.id,
    orderNumber: order.orderNumber,
    draftNumber: order.draftNumber,
    organizationId: params.organizationId,
    actor: params.actor,
    eventType: "PAID",
    fromStatus: order.status,
    toStatus: order.status,
    payload: {
      paymentReference: params.paymentReference,
      amountMinor: amount,
      paymentId: payment.id,
    },
  });

  return payment;
}

/**
 * Fulfills an order and commits inventory deduction.
 * NON-NEGOTIABLE RULE 1:
 * Enforces assertOrderApproved(order) BEFORE modifying inventory.
 */
export async function fulfillOrder(params: {
  orderId: string;
  organizationId: string;
  actor: {
    id: string;
    role?: string;
    type?: "USER" | "SYSTEM";
  };
}) {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
    include: {
      lines: true,
      customer: true,
    },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  // ENFORCE SERVER-SIDE APPROVAL GUARD (Rule 1)
  assertOrderApproved(order);

  if (order.status === "DELIVERED" || order.status === "DISPATCHED") {
    throw new OrderOperationError("Order is already fulfilled/dispatched", "ALREADY_FULFILLED");
  }

  const updated = await prisma.$transaction(async (tx) => {
    // 1. Commit inventory deduction via InventoryProvider interface (ERP seam)
    const inventoryProvider = getInventoryProvider();
    for (const line of order.lines) {
      if (line.productId) {
        try {
          await inventoryProvider.commit(
            params.organizationId,
            line.productId,
            line.qty,
            {
              orderId: order.id,
              actorId: params.actor.id ?? undefined,
              client: tx,
            },
          );
        } catch (invErr: unknown) {
          const msg = invErr instanceof Error ? invErr.message : String(invErr);
          throw new OrderOperationError(
            msg || `Insufficient stock to fulfill SKU ${line.sku}`,
            "INSUFFICIENT_STOCK",
          );
        }
      }
    }

    // 2. Create Fulfillment record
    await tx.fulfillment.create({
      data: {
        organizationId: params.organizationId,
        orderId: order.id,
        status: "DISPATCHED",
        dispatchedAt: new Date(),
        notes: `Fulfilled Order ${order.orderNumber ?? order.draftNumber}`,
      },
    });

    // 3. Mark order DISPATCHED
    const finished = await tx.order.update({
      where: { id: order.id },
      data: { status: "DISPATCHED" },
      include: { lines: true, customer: true },
    });

    return finished;
  });

  await recordOrderStateChange({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    draftNumber: updated.draftNumber,
    organizationId: params.organizationId,
    actor: {
      id: params.actor.id,
      type: params.actor.type ?? "USER",
      role: params.actor.role,
    },
    eventType: "FULFILLED",
    fromStatus: order.status,
    toStatus: "DISPATCHED",
    payload: {
      lineCount: order.lines.length,
      orderNumber: updated.orderNumber,
    },
  });

  return updated;
}
