import { describe, expect, it } from "vitest";
import {
  assertOrderApproved,
  isOrderApproved,
  OrderApprovalError,
  type OrderForApprovalCheck,
} from "./approval";
import type { OrderStatus } from "@rf-intelligence/db";

describe("Rule 1: assertOrderApproved Server-Side Enforcement", () => {
  const approvedAt = new Date("2026-10-12T10:00:00Z");
  const approvedById = "usr_client_admin_1";

  it("permits approved operational statuses when approver and timestamp are present", () => {
    const validStatuses: OrderStatus[] = ["APPROVED", "FULFILLING", "DISPATCHED", "DELIVERED"];

    for (const status of validStatuses) {
      const order: OrderForApprovalCheck = {
        id: `ord_${status.toLowerCase()}`,
        status,
        approvedById,
        approvedAt,
      };

      expect(isOrderApproved(order)).toBe(true);
      expect(() => assertOrderApproved(order)).not.toThrow();
    }
  });

  it("rejects non-approved statuses (DRAFT, NEEDS_REVIEW, REJECTED, CANCELLED)", () => {
    const unapprovedStatuses: OrderStatus[] = [
      "DRAFT",
      "NEEDS_REVIEW",
      "REJECTED",
      "CANCELLED",
    ];

    for (const status of unapprovedStatuses) {
      const order: OrderForApprovalCheck = {
        id: `ord_${status.toLowerCase()}`,
        status,
        approvedById,
        approvedAt,
      };

      expect(isOrderApproved(order)).toBe(false);
      expect(() => assertOrderApproved(order)).toThrow(OrderApprovalError);
      expect(() => assertOrderApproved(order)).toThrow(
        /has not been explicitly approved by a CLIENT_ADMIN or ADMIN/i,
      );
    }
  });

  it("rejects orders with status APPROVED but missing approvedById", () => {
    const missingApprover: OrderForApprovalCheck = {
      id: "ord_no_approver",
      status: "APPROVED",
      approvedById: null,
      approvedAt,
    };

    expect(isOrderApproved(missingApprover)).toBe(false);
    expect(() => assertOrderApproved(missingApprover)).toThrow(OrderApprovalError);

    const emptyApprover: OrderForApprovalCheck = {
      id: "ord_empty_approver",
      status: "APPROVED",
      approvedById: "   ",
      approvedAt,
    };

    expect(isOrderApproved(emptyApprover)).toBe(false);
    expect(() => assertOrderApproved(emptyApprover)).toThrow(OrderApprovalError);
  });

  it("rejects orders with status APPROVED but missing approvedAt timestamp", () => {
    const missingTimestamp: OrderForApprovalCheck = {
      id: "ord_no_timestamp",
      status: "APPROVED",
      approvedById,
      approvedAt: null,
    };

    expect(isOrderApproved(missingTimestamp)).toBe(false);
    expect(() => assertOrderApproved(missingTimestamp)).toThrow(OrderApprovalError);
  });

  it("rejects null or undefined order objects safely", () => {
    // @ts-expect-error intentionally passing invalid input
    expect(isOrderApproved(null)).toBe(false);
    // @ts-expect-error intentionally passing invalid input
    expect(() => assertOrderApproved(null)).toThrow(OrderApprovalError);
  });
});
