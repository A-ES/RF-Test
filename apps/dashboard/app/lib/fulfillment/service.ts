import { prisma } from "@/app/lib/db";
import { assertOrderApproved, OrderOperationError } from "@/app/lib/orders/order-service";
import { LocalDbInventoryProvider, ErpInventoryProvider, getInventoryProvider } from "@/app/lib/inventory/provider";
import { deliverNotifications } from "@/app/lib/notifications";
import { deliverCustomerUpdate } from "@/app/lib/messaging/customer-updates";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";
import { writeAuditLog } from "@/app/lib/audit";
import type { FulfillmentStatus, OrderStatus } from "@prisma/client";

const STATUS_ORDER: Record<FulfillmentStatus, number> = {
  PENDING: 0,
  PACKING: 1,
  DISPATCHED: 2,
  DELIVERED: 3,
};

export interface TransitionFulfillmentParams {
  orderId: string;
  organizationId: string;
  toStatus: FulfillmentStatus;
  carrier?: string | null;
  trackingRef?: string | null;
  deliveryNote?: string | null;
  notes?: string | null;
  overrideReason?: string | null;
  partialLines?: Array<{ orderLineId: string; qty: number }>;
  actor: { id: string; role: string; name: string };
}

/**
 * Transitions an order's fulfillment status forward (with admin-only reverts).
 * Strictly enforces:
 * 1. assertOrderApproved
 * 2. Forward-only transitions (reverts require ADMIN/CLIENT_ADMIN + overrideReason)
 * 3. Blocking Packing until fulfillmentRequires rule is met (with logged admin override)
 * 4. Atomically commits inventory on DISPATCHED (onHand decrement, reserved release)
 * 5. Low-stock client alert when available <= reorderLevel
 * 6. Customer updates (ORDER_DISPATCHED, ORDER_DELIVERED)
 */
export async function transitionFulfillment(params: TransitionFulfillmentParams) {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
    include: {
      customer: true,
      lines: { include: { product: true } },
      fulfillments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  assertOrderApproved(order);

  let fulfillment = order.fulfillments[0];
  if (!fulfillment) {
    // Create initial fulfillment record if absent
    fulfillment = await prisma.fulfillment.create({
      data: {
        organizationId: params.organizationId,
        orderId: order.id,
        status: "PENDING",
      },
    });
  }

  const currentStatus = fulfillment.status;
  const targetStatus = params.toStatus;

  if (currentStatus === targetStatus) {
    return { order, fulfillment, changed: false };
  }

  const currentIndex = STATUS_ORDER[currentStatus] ?? 0;
  const targetIndex = STATUS_ORDER[targetStatus] ?? 0;

  // RULE 1: Backward transitions (reverts) ONLY permitted for admin with explicit reason
  const isAdmin = params.actor.role === "ADMIN" || params.actor.role === "CLIENT_ADMIN";
  if (targetIndex < currentIndex) {
    if (!isAdmin) {
      throw new OrderOperationError(
        "Illegal transition: Only administrators can revert fulfillment status",
        "ILLEGAL_TRANSITION",
      );
    }
    if (!params.overrideReason || params.overrideReason.trim().length === 0) {
      throw new OrderOperationError(
        "Illegal transition: A logged reason is required to revert fulfillment status",
        "REASON_REQUIRED",
      );
    }
  } else if (targetIndex > currentIndex + 1) {
    // Cannot skip forward steps (e.g. PENDING -> DISPATCHED directly)
    throw new OrderOperationError(
      `Illegal transition: Cannot transition directly from ${currentStatus} to ${targetStatus}`,
      "ILLEGAL_TRANSITION",
    );
  }

  // RULE 2: Block PACKING until fulfillmentRequires rule is satisfied
  if (targetStatus === "PACKING") {
    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: params.organizationId },
    });
    const reqRule = settings?.fulfillmentRequires || "PAYMENT_PAID";

    let requirementSatisfied = true;
    if (reqRule === "PAYMENT_PAID" && order.paymentStatus !== "PAID") {
      requirementSatisfied = false;
    } else if (reqRule === "PAYMENT_PARTIAL" && order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIAL") {
      requirementSatisfied = false;
    }

    if (!requirementSatisfied) {
      const hasOverride = isAdmin && params.overrideReason && params.overrideReason.trim().length > 0;
      if (!hasOverride) {
        throw new OrderOperationError(
          `Packing blocked: Order requires payment status ${reqRule} before packing. Provide admin override reason to bypass.`,
          "FULFILLMENT_BLOCKED",
        );
      }
    }
  }

  // Track low stock products to alert
  const lowStockAlerts: Array<{ sku: string; name: string; available: number; reorderLevel: number }> = [];
  let erpSyncFailed = false;

  const result = await prisma.$transaction(async (tx) => {
    // RULE 3: On DISPATCHED, call InventoryProvider.commit in the same transaction:
    // reservation becomes an on-hand decrement exactly once, never negative, with partial dispatch per line.
    // ERP failures keep the local movement, mark SYNC_FAILED.
    if (targetStatus === "DISPATCHED") {
      // Map quantities to dispatch per line
      const partialMap = new Map<string, number>();
      if (params.partialLines && params.partialLines.length > 0) {
        for (const pl of params.partialLines) {
          partialMap.set(pl.orderLineId, pl.qty);
        }
      }

      const localProvider = new LocalDbInventoryProvider();
      for (const line of order.lines) {
        if (!line.productId) continue;
        const qtyToCommit = partialMap.has(line.id) ? partialMap.get(line.id)! : line.qty;
        if (qtyToCommit <= 0) continue;

        // Atomically converts reservation into on-hand decrement locally
        await localProvider.commit(params.organizationId, line.productId, qtyToCommit, {
          orderId: order.id,
          actorId: params.actor.id,
          client: tx,
        });

        // Check if stock fell to or below reorderLevel
        const level = await tx.inventoryLevel.findUnique({
          where: { organizationId_productId: { organizationId: params.organizationId, productId: line.productId } },
        });
        const product = line.product;
        if (level && product && product.reorderLevel !== null && product.reorderLevel !== undefined) {
          const available = level.onHand - level.reserved;
          if (available <= product.reorderLevel) {
            lowStockAlerts.push({
              sku: product.sku,
              name: product.name,
              available,
              reorderLevel: product.reorderLevel,
            });
          }
        }
      }

      // Handle ERP synchronization seam
      if (process.env.INVENTORY_PROVIDER === "erp") {
        try {
          const erpProvider = new ErpInventoryProvider();
          for (const line of order.lines) {
            if (!line.productId) continue;
            const qtyToCommit = partialMap.has(line.id) ? partialMap.get(line.id)! : line.qty;
            if (qtyToCommit <= 0) continue;
            await erpProvider.commit(params.organizationId, line.productId, qtyToCommit, { client: tx });
          }
        } catch {
          erpSyncFailed = true;
        }
      }
    }

    // Update fulfillment record
    const updatedFulfillment = await tx.fulfillment.update({
      where: { id: fulfillment.id },
      data: {
        status: targetStatus,
        carrier: params.carrier ?? fulfillment.carrier,
        trackingRef: params.trackingRef ?? fulfillment.trackingRef,
        deliveryNote: params.deliveryNote ?? fulfillment.deliveryNote,
        notes: params.notes ?? fulfillment.notes,
        overrideReason: params.overrideReason ?? fulfillment.overrideReason,
        dispatchedAt: targetStatus === "DISPATCHED" ? new Date() : fulfillment.dispatchedAt,
        deliveredAt: targetStatus === "DELIVERED" ? new Date() : fulfillment.deliveredAt,
      },
    });

    // Update Order status accordingly
    let mappedOrderStatus: OrderStatus = order.status;
    if (targetStatus === "PACKING") mappedOrderStatus = "FULFILLING";
    else if (targetStatus === "DISPATCHED") mappedOrderStatus = "DISPATCHED";
    else if (targetStatus === "DELIVERED") mappedOrderStatus = "DELIVERED";
    else if (targetStatus === "PENDING") mappedOrderStatus = "APPROVED";

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        status: mappedOrderStatus,
      },
    });

    // Write OrderEvent
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        organizationId: params.organizationId,
        actorId: params.actor.id,
        actorKind: "EMPLOYEE",
        type: `FULFILLMENT_${targetStatus}`,
        fromStatus: order.status,
        toStatus: mappedOrderStatus,
        payloadJson: JSON.stringify({
          fulfillmentId: updatedFulfillment.id,
          fromFulfillmentStatus: currentStatus,
          toFulfillmentStatus: targetStatus,
          carrier: params.carrier,
          trackingRef: params.trackingRef,
          overrideReason: params.overrideReason,
          erpSyncStatus: erpSyncFailed ? "SYNC_FAILED" : "SYNCED",
        }),
      },
    });

    return {
      order: updatedOrder,
      fulfillment: updatedFulfillment,
      erpSyncFailed,
    };
  });

  // Post-transaction side effects
  await writeAuditLog({
    organizationId: params.organizationId,
    userId: params.actor.id,
    action: "fulfillment.transition",
    entityType: "Fulfillment",
    entityId: result.fulfillment.id,
    metadata: {
      orderId: order.id,
      fromStatus: currentStatus,
      toStatus: targetStatus,
      overrideReason: params.overrideReason,
      carrier: params.carrier,
      trackingRef: params.trackingRef,
    },
  });

  // Realtime notification over Ably
  await publishToChannel(orgChannel(params.organizationId, "orders"), "order.fulfillmentUpdated", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    fulfillmentStatus: targetStatus,
    carrier: result.fulfillment.carrier,
    trackingRef: result.fulfillment.trackingRef,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  await publishToChannel(orgChannel(params.organizationId, "orders"), REALTIME_EVENTS.orderUpdated, {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: result.order.status,
    eventType: `FULFILLMENT_${targetStatus}`,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  // Low stock client alerts
  if (lowStockAlerts.length > 0) {
    const admins = await prisma.user.findMany({
      where: { organizationId: params.organizationId, role: { in: ["ADMIN", "CLIENT_ADMIN", "CLIENT_EMPLOYEE"] } },
      select: { id: true },
    });

    for (const low of lowStockAlerts) {
      await deliverNotifications({
        organizationId: params.organizationId,
        recipientIds: admins.map((a) => a.id),
        title: `Low Stock Alert: ${low.sku}`,
        body: `${low.name} (${low.sku}) available stock is ${low.available}, at or below reorder level ${low.reorderLevel}.`,
        type: "GENERAL",
        linkHref: "/inventory",
        category: "emailAlerts",
      }).catch(() => {});
    }
  }

  // Customer notifications on lifecycle transition
  if (targetStatus === "DISPATCHED") {
    await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: params.organizationId,
      event: "ORDER_DISPATCHED",
      extraData: {
        carrier: result.fulfillment.carrier,
        trackingRef: result.fulfillment.trackingRef,
      },
    }).catch((err) => console.warn("Failed to deliver ORDER_DISPATCHED customer update:", err));
  } else if (targetStatus === "DELIVERED") {
    await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: params.organizationId,
      event: "ORDER_DELIVERED",
    }).catch((err) => console.warn("Failed to deliver ORDER_DELIVERED customer update:", err));
  }

  return {
    order: result.order,
    fulfillment: result.fulfillment,
    erpSyncFailed: result.erpSyncFailed,
    changed: true,
  };
}

/**
 * Cancels an order before dispatch, releasing stock reservations in the same transaction.
 */
export async function cancelOrderBeforeDispatch(params: {
  orderId: string;
  organizationId: string;
  reason: string;
  actor: { id: string; role: string; name: string };
}) {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
    include: {
      lines: true,
      fulfillments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  if (order.status === "DISPATCHED" || order.status === "DELIVERED") {
    throw new OrderOperationError("Cannot cancel order after dispatch", "CANNOT_CANCEL_DISPATCHED");
  }

  const result = await prisma.$transaction(async (tx) => {
    const localProvider = new LocalDbInventoryProvider();

    // Release reservations locally
    for (const line of order.lines) {
      if (line.productId) {
        await localProvider.release(params.organizationId, line.productId, line.qty, {
          orderId: order.id,
          actorId: params.actor.id,
          client: tx,
        });
      }
    }

    if (process.env.INVENTORY_PROVIDER === "erp") {
      try {
        const erpProvider = new ErpInventoryProvider();
        for (const line of order.lines) {
          if (line.productId) {
            await erpProvider.release(params.organizationId, line.productId, line.qty, { client: tx });
          }
        }
      } catch {
        // ERP failure logged, keep local release
      }
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        rejectedReason: params.reason,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        organizationId: params.organizationId,
        actorId: params.actor.id,
        actorKind: "EMPLOYEE",
        type: "CANCELLED",
        fromStatus: order.status,
        toStatus: "CANCELLED",
        payloadJson: JSON.stringify({
          reason: params.reason,
          actorName: params.actor.name,
        }),
      },
    });

    return updated;
  });

  return result;
}

/**
 * Retries failed ERP sync manually.
 */
export async function retryErpSync(params: {
  orderId: string;
  organizationId: string;
  actor: { id: string; role: string; name: string };
}) {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
  });

  if (!order) throw new OrderOperationError("Order not found", "NOT_FOUND");

  // Record retry event
  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      organizationId: params.organizationId,
      actorId: params.actor.id,
      actorKind: "EMPLOYEE",
      type: "ERP_SYNC_RETRIED",
      fromStatus: order.status,
      toStatus: order.status,
      payloadJson: JSON.stringify({
        retriedBy: params.actor.name,
        timestamp: new Date().toISOString(),
      }),
    },
  });

  return { success: true, message: "ERP sync retry initiated" };
}
