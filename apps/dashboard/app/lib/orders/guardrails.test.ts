import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/app/lib/db";
import { getInventoryProvider } from "@/app/lib/inventory/provider";
import { assertOrderApproved, OrderApprovalError, isOrderApproved } from "./approval";
import { approveOrder, OrderOperationError } from "./order-service";
import { PATCH as editDraftRoute } from "@/app/api/orders/[id]/draft/route";
import { POST as approveRoute } from "@/app/api/orders/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/orders/[id]/reject/route";
import { GET as getOrderRoute } from "@/app/api/orders/[id]/route";
import { GET as getTimelineRoute } from "@/app/api/orders/[id]/timeline/route";
import { GET as getCustomerRoute, PATCH as updateCustomerRoute } from "@/app/api/customers/[id]/route";
import { GET as getCustomerOrdersRoute } from "@/app/api/customers/[id]/orders/route";
import { GET as getConversationRoute, PATCH as updateConversationRoute } from "@/app/api/customer-conversations/[id]/route";
import { POST as replyConversationRoute } from "@/app/api/customer-conversations/[id]/reply/route";
import * as sessionModule from "@/app/lib/session";

function makeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("CI Operational Guardrail Tests", () => {
  let orgAId: string;
  let orgBId: string;
  let adminOrgA: { id: string; organizationId: string; role: string; name: string };
  let staffOrgA: { id: string; organizationId: string; role: string; name: string };
  let adminOrgB: { id: string; organizationId: string; role: string; name: string };
  let customerOrgA: { id: string; organizationId: string; name: string };
  let productA: { id: string; sku: string; name: string; basePriceMinor: number };
  let conversationOrgA: { id: string; organizationId: string };

  const createdOrgIds: string[] = [];

  function mockSession(user: { id: string; organizationId: string; role: string; name: string }) {
    vi.spyOn(sessionModule, "getSession").mockResolvedValue({
      mode: "CLIENT",
      userId: user.id,
      organizationId: user.organizationId,
      name: user.name,
      email: `${user.id}@example.com`,
      role: user.role,
    } as any);
  }

  beforeEach(async () => {
    orgAId = `org_gr_a_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    orgBId = `org_gr_b_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    createdOrgIds.push(orgAId, orgBId);

    await prisma.organization.createMany({
      data: [
        { id: orgAId, name: "Guardrail Org A" },
        { id: orgBId, name: "Guardrail Org B" },
      ],
    });

    adminOrgA = await prisma.user.create({
      data: {
        organizationId: orgAId,
        name: "Admin A",
        email: `admin-a-${Date.now()}@example.com`,
        role: "CLIENT_ADMIN",
        avatarInitials: "AA",
      },
    });

    staffOrgA = await prisma.user.create({
      data: {
        organizationId: orgAId,
        name: "Staff A",
        email: `staff-a-${Date.now()}@example.com`,
        role: "CLIENT_EMPLOYEE",
        avatarInitials: "SA",
      },
    });

    adminOrgB = await prisma.user.create({
      data: {
        organizationId: orgBId,
        name: "Admin B",
        email: `admin-b-${Date.now()}@example.com`,
        role: "CLIENT_ADMIN",
        avatarInitials: "AB",
      },
    });

    customerOrgA = await prisma.customer.create({
      data: {
        organizationId: orgAId,
        name: "Customer Org A",
        whatsapp: `+9198765${Math.floor(10000 + Math.random() * 90000)}`,
        tagsJson: "[]",
      },
    });

    productA = await prisma.product.create({
      data: {
        organizationId: orgAId,
        sku: "PROD-GR-A",
        name: "Guardrail Product A",
        unit: "cases",
        basePriceMinor: 50000, // ₹500.00
        taxRateBps: 1800, // 18%
      },
    });

    const inventoryProvider = getInventoryProvider();
    await inventoryProvider.adjust(orgAId, productA.id, 100, {
      reason: "ADJUSTMENT",
      actorId: adminOrgA.id,
    });

    conversationOrgA = await prisma.customerConversation.create({
      data: {
        organizationId: orgAId,
        customerId: customerOrgA.id,
        channel: "WHATSAPP",
        status: "OPEN",
        subject: "Order Inquiry",
        tagsJson: "[]",
      },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
      createdOrgIds.length = 0;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GUARDRAIL 1: No path other than approve/fulfillment reaches APPROVED
  // ───────────────────────────────────────────────────────────────────────────
  describe("Guardrail 1: Approval State Isolation", () => {
    it("draft edits cannot elevate an order to APPROVED or later", async () => {
      mockSession(adminOrgA);

      const draft = await prisma.order.create({
        data: {
          organizationId: orgAId,
          draftNumber: "DFT-GR-01",
          customerId: customerOrgA.id,
          status: "DRAFT",
          totalMinor: 59000,
          subtotalMinor: 50000,
          taxMinor: 9000,
          version: 1,
          lines: {
            create: [
              {
                organizationId: orgAId,
                productId: productA.id,
                sku: productA.sku,
                rawText: "1 case",
                qty: 1,
                unitPriceMinor: 50000,
                lineTotalMinor: 50000,
              },
            ],
          },
        },
      });

      // Attempting to inject status: "APPROVED" via draft edit route
      const res = await editDraftRoute(
        new Request(`http://localhost/api/orders/${draft.id}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: 1,
            status: "APPROVED",
            lines: [
              {
                productId: productA.id,
                sku: productA.sku,
                rawText: "1 case",
                qty: 1,
              },
            ],
          }),
        }),
        makeContext(draft.id),
      );

      expect(res.status).toBe(200);
      const updated = await prisma.order.findUnique({ where: { id: draft.id } });
      expect(["DRAFT", "NEEDS_REVIEW"]).toContain(updated?.status);
      expect(updated?.status).not.toBe("APPROVED");
      expect(updated?.approvedById).toBeNull();
      expect(updated?.approvedAt).toBeNull();
      expect(updated?.orderNumber).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GUARDRAIL 2: Zero StockMovement for DRAFT
  // ───────────────────────────────────────────────────────────────────────────
  describe("Guardrail 2: Stock Isolation for Drafts", () => {
    it("creates draft and edits lines with exactly zero StockMovements and zero reserved stock", async () => {
      mockSession(adminOrgA);

      const draft = await prisma.order.create({
        data: {
          organizationId: orgAId,
          draftNumber: "DFT-GR-STOCK",
          customerId: customerOrgA.id,
          status: "DRAFT",
          totalMinor: 59000,
          subtotalMinor: 50000,
          taxMinor: 9000,
          version: 1,
          lines: {
            create: [
              {
                organizationId: orgAId,
                productId: productA.id,
                sku: productA.sku,
                rawText: "10 cases",
                qty: 10,
                unitPriceMinor: 50000,
                lineTotalMinor: 500000,
              },
            ],
          },
        },
      });

      // 1. Verify 0 stock movements on draft creation
      const movementsBefore = await prisma.stockMovement.findMany({
        where: { orderId: draft.id },
      });
      expect(movementsBefore.length).toBe(0);

      const inventoryProvider = getInventoryProvider();
      const stockBefore = await inventoryProvider.getStock(orgAId, productA.id);
      expect(stockBefore.onHand).toBe(100);
      expect(stockBefore.reserved).toBe(0);
      expect(stockBefore.available).toBe(100);

      // 2. Edit draft via API
      await editDraftRoute(
        new Request(`http://localhost/api/orders/${draft.id}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: 1,
            lines: [
              {
                productId: productA.id,
                sku: productA.sku,
                rawText: "15 cases",
                qty: 15,
              },
            ],
          }),
        }),
        makeContext(draft.id),
      );

      // 3. Verify STILL 0 stock movements and 0 reservations
      const movementsAfter = await prisma.stockMovement.findMany({
        where: { orderId: draft.id },
      });
      expect(movementsAfter.length).toBe(0);

      const stockAfter = await inventoryProvider.getStock(orgAId, productA.id);
      expect(stockAfter.onHand).toBe(100);
      expect(stockAfter.reserved).toBe(0);
      expect(stockAfter.available).toBe(100);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GUARDRAIL 3: Confirmation Gate (assertOrderApproved)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Guardrail 3: Confirmation & Messaging Gate", () => {
    it("throws OrderApprovalError for DRAFT, NEEDS_REVIEW, REJECTED and CANCELLED orders", () => {
      const draftOrder = {
        id: "ord_1",
        status: "DRAFT" as const,
        approvedById: null,
        approvedAt: null,
      };
      expect(() => assertOrderApproved(draftOrder)).toThrow(OrderApprovalError);
      expect(isOrderApproved(draftOrder)).toBe(false);

      const needsReviewOrder = {
        id: "ord_2",
        status: "NEEDS_REVIEW" as const,
        approvedById: null,
        approvedAt: null,
      };
      expect(() => assertOrderApproved(needsReviewOrder)).toThrow(OrderApprovalError);
      expect(isOrderApproved(needsReviewOrder)).toBe(false);

      const rejectedOrder = {
        id: "ord_3",
        status: "REJECTED" as const,
        approvedById: "usr_admin",
        approvedAt: new Date(),
      };
      expect(() => assertOrderApproved(rejectedOrder)).toThrow(OrderApprovalError);
      expect(isOrderApproved(rejectedOrder)).toBe(false);

      const approvedOrder = {
        id: "ord_4",
        status: "APPROVED" as const,
        approvedById: "usr_admin",
        approvedAt: new Date(),
      };
      expect(() => assertOrderApproved(approvedOrder)).not.toThrow();
      expect(isOrderApproved(approvedOrder)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GUARDRAIL 4: Non-admin and AI actors cannot approve
  // ───────────────────────────────────────────────────────────────────────────
  describe("Guardrail 4: Actor Authorization Enforcement", () => {
    it("rejects approval by employee / non-admin user with 403 Forbidden", async () => {
      mockSession(staffOrgA);

      const draft = await prisma.order.create({
        data: {
          organizationId: orgAId,
          draftNumber: "DFT-AUTH-REJECT",
          customerId: customerOrgA.id,
          status: "DRAFT",
          totalMinor: 59000,
          subtotalMinor: 50000,
          taxMinor: 9000,
          version: 1,
        },
      });

      const res = await approveRoute(
        new Request(`http://localhost/api/orders/${draft.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 1 }),
        }),
        makeContext(draft.id),
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("FORBIDDEN");
    });

    it("order-service rejects approval by AI or non-admin actor", async () => {
      const draft = await prisma.order.create({
        data: {
          organizationId: orgAId,
          draftNumber: "DFT-AI-REJECT",
          customerId: customerOrgA.id,
          status: "DRAFT",
          totalMinor: 59000,
          subtotalMinor: 50000,
          taxMinor: 9000,
          version: 1,
        },
      });

      // AI attempt
      await expect(
        approveOrder({
          orderId: draft.id,
          organizationId: orgAId,
          approver: {
            id: "ai_system",
            role: "AI",
            name: "Autonomous LLM",
          },
          version: 1,
        }),
      ).rejects.toThrow(OrderOperationError);

      // Employee attempt
      await expect(
        approveOrder({
          orderId: draft.id,
          organizationId: orgAId,
          approver: {
            id: staffOrgA.id,
            role: "CLIENT_EMPLOYEE",
            name: staffOrgA.name,
          },
          version: 1,
        }),
      ).rejects.toThrow(OrderOperationError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GUARDRAIL 5: Cross-organisation access to every new route returns 404
  // ───────────────────────────────────────────────────────────────────────────
  describe("Guardrail 5: Multi-Tenant RLS & 404 Isolation", () => {
    let orderA: { id: string };

    beforeEach(async () => {
      orderA = await prisma.order.create({
        data: {
          organizationId: orgAId,
          draftNumber: "DFT-TENANT-01",
          customerId: customerOrgA.id,
          status: "DRAFT",
          totalMinor: 59000,
          subtotalMinor: 50000,
          taxMinor: 9000,
          version: 1,
        },
      });
    });

    it("cross-organization access to GET /api/orders/:id returns 404", async () => {
      mockSession(adminOrgB);
      const res = await getOrderRoute(
        new Request(`http://localhost/api/orders/${orderA.id}`),
        makeContext(orderA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to PATCH /api/orders/:id/draft returns 404", async () => {
      mockSession(adminOrgB);
      const res = await editDraftRoute(
        new Request(`http://localhost/api/orders/${orderA.id}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 1, lines: [] }),
        }),
        makeContext(orderA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to POST /api/orders/:id/approve returns 404", async () => {
      mockSession(adminOrgB);
      const res = await approveRoute(
        new Request(`http://localhost/api/orders/${orderA.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 1 }),
        }),
        makeContext(orderA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to POST /api/orders/:id/reject returns 404", async () => {
      mockSession(adminOrgB);
      const res = await rejectRoute(
        new Request(`http://localhost/api/orders/${orderA.id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Malicious cross-org call" }),
        }),
        makeContext(orderA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to GET /api/orders/:id/timeline returns 404", async () => {
      mockSession(adminOrgB);
      const res = await getTimelineRoute(
        new Request(`http://localhost/api/orders/${orderA.id}/timeline`),
        makeContext(orderA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to GET /api/customers/:id returns 404", async () => {
      mockSession(adminOrgB);
      const res = await getCustomerRoute(
        new Request(`http://localhost/api/customers/${customerOrgA.id}`),
        makeContext(customerOrgA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to PATCH /api/customers/:id returns 404", async () => {
      mockSession(adminOrgB);
      const res = await updateCustomerRoute(
        new Request(`http://localhost/api/customers/${customerOrgA.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Hacked Name" }),
        }),
        makeContext(customerOrgA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to GET /api/customers/:id/orders returns 404", async () => {
      mockSession(adminOrgB);
      const res = await getCustomerOrdersRoute(
        new Request(`http://localhost/api/customers/${customerOrgA.id}/orders`),
        makeContext(customerOrgA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to GET /api/customer-conversations/:id returns 404", async () => {
      mockSession(adminOrgB);
      const res = await getConversationRoute(
        new Request(`http://localhost/api/customer-conversations/${conversationOrgA.id}`),
        makeContext(conversationOrgA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to PATCH /api/customer-conversations/:id returns 404", async () => {
      mockSession(adminOrgB);
      const res = await updateConversationRoute(
        new Request(`http://localhost/api/customer-conversations/${conversationOrgA.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "CLOSED" }),
        }),
        makeContext(conversationOrgA.id),
      );
      expect(res.status).toBe(404);
    });

    it("cross-organization access to POST /api/customer-conversations/:id/reply returns 404", async () => {
      mockSession(adminOrgB);
      const res = await replyConversationRoute(
        new Request(`http://localhost/api/customer-conversations/${conversationOrgA.id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "Unauthorized reply" }),
        }),
        makeContext(conversationOrgA.id),
      );
      expect(res.status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GUARDRAIL 6: Server always re-prices and ignores client-supplied totals
  // ───────────────────────────────────────────────────────────────────────────
  describe("Guardrail 6: Server-Side Pure Pricing Authority", () => {
    it("completely discards client-supplied totalMinor, subtotalMinor and taxMinor", async () => {
      mockSession(adminOrgA);

      const draft = await prisma.order.create({
        data: {
          organizationId: orgAId,
          draftNumber: "DFT-PRICE-TEST",
          customerId: customerOrgA.id,
          status: "DRAFT",
          totalMinor: 59000,
          subtotalMinor: 50000,
          taxMinor: 9000,
          version: 1,
        },
      });

      // Client attempts to pass fraudulent zero amounts:
      // 5 cases of productA (5 * 50,000 = 250,000 minor) + 18% tax (45,000 minor) = 295,000 minor total.
      // Client supplies: totalMinor: 100, subtotalMinor: 100, taxMinor: 0
      const res = await editDraftRoute(
        new Request(`http://localhost/api/orders/${draft.id}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: 1,
            totalMinor: 100,
            subtotalMinor: 100,
            taxMinor: 0,
            lines: [
              {
                productId: productA.id,
                sku: productA.sku,
                rawText: "5 cases",
                qty: 5,
              },
            ],
          }),
        }),
        makeContext(draft.id),
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      // Server must calculate 250,000 subtotal, 45,000 tax, 295,000 total
      expect(body.order.subtotalMinor).toBe(250000);
      expect(body.order.taxMinor).toBe(45000);
      expect(body.order.totalMinor).toBe(295000);

      const dbOrder = await prisma.order.findUnique({
        where: { id: draft.id },
      });
      expect(dbOrder?.subtotalMinor).toBe(250000);
      expect(dbOrder?.taxMinor).toBe(45000);
      expect(dbOrder?.totalMinor).toBe(295000);
    });
  });
});
