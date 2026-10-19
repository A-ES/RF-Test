import type { OrderStatus } from "@rf-intelligence/db";

export class OrderApprovalError extends Error {
  readonly code = "ORDER_NOT_APPROVED";

  constructor(message: string) {
    super(message);
    this.name = "OrderApprovalError";
  }
}

export interface OrderForApprovalCheck {
  id: string;
  status: OrderStatus;
  approvedById?: string | null;
  approvedAt?: Date | string | null;
}

/**
 * Validates whether an order has been legitimately approved by an authorized administrator.
 * Approved orders must have:
 * 1. A terminal/approved operational status (APPROVED, INVOICED, PAID, or FULFILLED)
 * 2. An explicit approvedById user reference
 * 3. An explicit approvedAt timestamp
 */
export function isOrderApproved(order: OrderForApprovalCheck): boolean {
  if (!order || !order.id) return false;

  const approvedStatuses: readonly OrderStatus[] = [
    "APPROVED",
    "FULFILLING",
    "DISPATCHED",
    "DELIVERED",
  ];

  const hasApprovedStatus = approvedStatuses.includes(order.status);
  const hasApprovedBy =
    typeof order.approvedById === "string" && order.approvedById.trim().length > 0;
  const hasApprovedAt = Boolean(order.approvedAt);

  return hasApprovedStatus && hasApprovedBy && hasApprovedAt;
}

/**
 * Core enforcement guard for WhatsApp-to-Order operations.
 *
 * NON-NEGOTIABLE RULE 1:
 * NEVER commit an order, change inventory, or send a final confirmation without an explicit
 * approval by a CLIENT_ADMIN or ADMIN. Enforce this in ONE server-side function
 * (assertOrderApproved) that every confirming code path calls, not only in the UI.
 *
 * @throws {OrderApprovalError} if the order has not been approved by an administrator
 */
export function assertOrderApproved(order: OrderForApprovalCheck): void {
  if (!isOrderApproved(order)) {
    const status = order?.status ?? "UNKNOWN";
    const approvedBy = order?.approvedById ?? "none";
    throw new OrderApprovalError(
      `Action rejected: Order ${order?.id ?? "unknown"} has not been explicitly approved by a CLIENT_ADMIN or ADMIN (status: ${status}, approvedBy: ${approvedBy}). Every confirming code path, inventory modification, or customer confirmation requires explicit approval.`,
    );
  }
}
