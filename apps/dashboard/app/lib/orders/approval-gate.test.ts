import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/app/lib/db";
import { getInventoryProvider } from "@/app/lib/inventory/provider";
import { assertOrderApproved, OrderApprovalError } from "./approval";
import { approveOrder, rejectOrder, OrderOperationError } from "./order-service";
import { PATCH as editDraftRoute } from "@/app/api/orders/[id]/draft/route";
import { POST as approveRoute } from "@/app/api/orders/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/orders/[id]/reject/route";
import { GET as getOrderRoute } from "@/app/api/orders/[id]/route";
import { GET as listOrdersRoute } from "@/app/api/orders/route";
import * as sessionModule from "@/app/lib/session";
import { vi } from "vitest";

function makeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("Approval Experience & Confirmation Gate Integration", () => {
  let orgId: string;
  let adminUser: { id: string; organizationId: string; role: string; name: string };
  let staffUser: { id: string; organizationId: string; role: string; name: string };
  let customer: { id: string; organizationId: string; name: string };
  let productA: { id: string; sku: string; name: string; basePriceMinor: number };
  let productB: { id: string; sku: string; name: string; basePriceMinor: number };

  beforeEach(async () => {
    orgId = `org_gate_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Seed test organization
    await prisma.organization.create({
      data: {
        id: orgId,
        name: "Test Org Gate",
      },
    });

    // Seed admin & employee
    adminUser = await prisma.user.create({
      data: {
        organizationId: orgId,
        name: "Admin User",
        email: `admin-${Date.now()}@example.com`,
        role: "CLIENT_ADMIN",
        avatarInitials: "AU",
      },
    });

    staffUser = await prisma.user.create({
      data: {
        organizationId: orgId,
        name: "Staff Member",
        email: `staff-${Date.now()}@example.com`,
        role: "MEMBER",
        avatarInitials: "SM",
      },
    });

    // Seed customer
    customer = await prisma.customer.create({
      data: {
        organizationId: orgId,
        name: "Acme Retailers",
        whatsapp: `+9198765${Math.floor(10000 + Math.random() * 90000)}`,
        tagsJson: "[]",
      },
    });

    // Seed products with inventory levels
    productA = await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: "PROD-GATE-A",
        name: "Product Gate A",
        unit: "cases",
        basePriceMinor: 50000, // ₹500
        taxRateBps: 1800, // 18%
      },
    });

    productB = await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: "PROD-GATE-B",
        name: "Product Gate B",
        unit: "units",
        basePriceMinor: 10000, // ₹100
        taxRateBps: 1800,
      },
    });

    const inventoryProvider = getInventoryProvider();
    await inventoryProvider.adjust(orgId, productA.id, 100, {
      reason: "ADJUSTMENT",
      actorId: adminUser.id,
    });
    await inventoryProvider.adjust(orgId, productB.id, 50, {
      reason: "ADJUSTMENT",
      actorId: adminUser.id,
    });
  });

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

  it("unauthorised role refused: non-admin (MEMBER/CLIENT_EMPLOYEE) cannot approve or reject", async () => {
    mockSession(staffUser);

    // Create a draft order
    const draft = await prisma.order.create({
      data: {
        organizationId: orgId,
        draftNumber: "DFT-AUTH-01",
        customerId: customer.id,
        status: "DRAFT",
        totalMinor: 10000,
        subtotalMinor: 10000,
        taxMinor: 1800,
        lines: {
          create: [
            {
              organizationId: orgId,
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

    // Try approve as staff member
    const approveRes = await approveRoute(
      new Request(`http://localhost/api/orders/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      }),
      makeContext(draft.id),
    );
    expect(approveRes.status).toBe(403);
    const approveJson = await approveRes.json();
    expect(approveJson.code).toBe("FORBIDDEN");

    // Try reject as staff member
    const rejectRes = await rejectRoute(
      new Request(`http://localhost/api/orders/${draft.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Unauthorized attempt" }),
      }),
      makeContext(draft.id),
    );
    expect(rejectRes.status).toBe(403);
    const rejectJson = await rejectRes.json();
    expect(rejectJson.code).toBe("FORBIDDEN");
  });

  it("stale version refused: optimistic concurrency returns 409 on version mismatch", async () => {
    mockSession(adminUser);

    const draft = await prisma.order.create({
      data: {
        organizationId: orgId,
        draftNumber: "DFT-VER-01",
        customerId: customer.id,
        status: "DRAFT",
        version: 3, // Current version is 3
        totalMinor: 59000,
        subtotalMinor: 50000,
        taxMinor: 9000,
        lines: {
          create: [
            {
              organizationId: orgId,
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

    // Attempt PATCH with stale version 2
    const editRes = await editDraftRoute(
      new Request(`http://localhost/api/orders/${draft.id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 2, // Stale version
          lines: [{ sku: productA.sku, qty: 5 }],
        }),
      }),
      makeContext(draft.id),
    );
    expect(editRes.status).toBe(409);
    const editJson = await editRes.json();
    expect(editJson.code).toBe("VERSION_CONFLICT");

    // Attempt approve with stale version 2
    const approveRes = await approveRoute(
      new Request(`http://localhost/api/orders/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 2, // Stale version
        }),
      }),
      makeContext(draft.id),
    );
    expect(approveRes.status).toBe(409);
    const approveJson = await approveRes.json();
    expect(approveJson.code).toBe("VERSION_CONFLICT");
  });

  it("editing an APPROVED order is refused", async () => {
    mockSession(adminUser);

    const approvedOrder = await prisma.order.create({
      data: {
        organizationId: orgId,
        draftNumber: "DFT-APP-01",
        orderNumber: "ORD-9999",
        customerId: customer.id,
        status: "APPROVED",
        approvedById: adminUser.id,
        approvedAt: new Date(),
        totalMinor: 59000,
        subtotalMinor: 50000,
        taxMinor: 9000,
        version: 1,
        lines: {
          create: [
            {
              organizationId: orgId,
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

    const res = await editDraftRoute(
      new Request(`http://localhost/api/orders/${approvedOrder.id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          lines: [{ sku: productA.sku, qty: 10 }],
        }),
      }),
      makeContext(approvedOrder.id),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("ORDER_NOT_EDITABLE");
  });

  it("concurrent approvals give one order number and one reservation", async () => {
    mockSession(adminUser);

    const draft = await prisma.order.create({
      data: {
        organizationId: orgId,
        draftNumber: "DFT-CONC-01",
        customerId: customer.id,
        status: "DRAFT",
        version: 1,
        totalMinor: 59000,
        subtotalMinor: 50000,
        taxMinor: 9000,
        lines: {
          create: [
            {
              organizationId: orgId,
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

    const initialReservedA =
      (await prisma.inventoryLevel.findUnique({
        where: { organizationId_productId: { organizationId: orgId, productId: productA.id } },
      }))?.reserved ?? 0;

    const idempotencyKey = `idemp_${Date.now()}_conc`;

    // Fire approval and retry with same idempotency key concurrently
    const [res1, res2] = await Promise.all([
      approveOrder({
        orderId: draft.id,
        organizationId: orgId,
        approver: { id: adminUser.id, role: "CLIENT_ADMIN", name: adminUser.name },
        version: 1,
        idempotencyKey,
      }),
      approveOrder({
        orderId: draft.id,
        organizationId: orgId,
        approver: { id: adminUser.id, role: "CLIENT_ADMIN", name: adminUser.name },
        version: 1,
        idempotencyKey,
      }),
    ]);

    // Both return the exact same orderNumber
    expect(res1.orderNumber).toBeDefined();
    expect(res1.orderNumber).toBe(res2.orderNumber);
    expect(res1.status).toBe("APPROVED");
    expect(res2.status).toBe("APPROVED");

    // Stock was reserved exactly ONCE (incremented by 10, not 20)
    const levelAfter = await prisma.inventoryLevel.findUnique({
      where: { organizationId_productId: { organizationId: orgId, productId: productA.id } },
    });
    expect(levelAfter?.reserved).toBe(initialReservedA + 10);

    // Stock movements count for ORDER_RESERVE is exactly 1 for this order
    const movements = await prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        orderId: draft.id,
        reason: "ORDER_RESERVE",
      },
    });
    expect(movements).toHaveLength(1);
  });

  it("reject releases nothing that was never reserved", async () => {
    mockSession(adminUser);

    const draft = await prisma.order.create({
      data: {
        organizationId: orgId,
        draftNumber: "DFT-REJ-01",
        customerId: customer.id,
        status: "DRAFT", // Never approved -> never reserved
        totalMinor: 59000,
        subtotalMinor: 50000,
        taxMinor: 9000,
        lines: {
          create: [
            {
              organizationId: orgId,
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

    const initialMovementsCount = await prisma.stockMovement.count({
      where: { organizationId: orgId },
    });

    // Reject the draft
    const res = await rejectRoute(
      new Request(`http://localhost/api/orders/${draft.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Customer changed mind before approval",
        }),
      }),
      makeContext(draft.id),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rejected).toBe(true);
    expect(json.order.status).toBe("REJECTED");
    expect(json.order.rejectedReason).toBe("Customer changed mind before approval");

    // Proves: zero reservation movements were created (nothing released because nothing was reserved)
    const releaseMovements = await prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        orderId: draft.id,
        reason: "ORDER_RELEASE",
      },
    });
    expect(releaseMovements).toHaveLength(0);
  });

  it("Done When: admin opens draft, edits qty, totals recalculate, approves to get orderNumber & reservation with no customer message, and rejects second draft with reason", async () => {
    mockSession(adminUser);

    // ── STEP 1: Draft from Prompt B: '20 cases of Product A and 10 units of Product B delivered tomorrow' ──
    const draftB = await prisma.order.create({
      data: {
        organizationId: orgId,
        draftNumber: "DFT-SPEC-01",
        orderNumber: null,
        customerId: customer.id,
        status: "DRAFT",
        version: 1,
        currency: "INR",
        subtotalMinor: 1100000, // 20*50000 + 10*10000
        taxMinor: 198000,
        totalMinor: 1298000,
        deliveryDate: new Date(Date.now() + 86400000),
        flagsJson: JSON.stringify([]),
        lines: {
          create: [
            {
              organizationId: orgId,
              productId: productA.id,
              sku: productA.sku,
              rawText: "20 cases of Product A",
              qty: 20,
              unitPriceMinor: 50000,
              lineTotalMinor: 1000000,
            },
            {
              organizationId: orgId,
              productId: productB.id,
              sku: productB.sku,
              rawText: "10 units of Product B",
              qty: 10,
              unitPriceMinor: 10000,
              lineTotalMinor: 100000,
            },
          ],
        },
      },
      include: { lines: true },
    });

    // ── STEP 2: Edit quantity (e.g. increase Product B qty from 10 to 15) and watch totals recalculate ──
    const editRes = await editDraftRoute(
      new Request(`http://localhost/api/orders/${draftB.id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          // Client-supplied totals are passed to verify they are strictly ignored by server
          subtotalMinor: 1,
          totalMinor: 1,
          lines: [
            {
              id: draftB.lines[0].id,
              productId: productA.id,
              sku: productA.sku,
              qty: 20,
              rawText: "20 cases of Product A",
            },
            {
              id: draftB.lines[1].id,
              productId: productB.id,
              sku: productB.sku,
              qty: 15, // Edited qty: from 10 to 15
              rawText: "15 units of Product B",
            },
          ],
          deliveryAddress: "42 MG Road, Industrial Area, Bangalore",
        }),
      }),
      makeContext(draftB.id),
    );

    expect(editRes.status).toBe(200);
    const editJson = await editRes.json();
    const recalculatedOrder = editJson.order;

    // Server recalculated totals with priceOrder:
    // Subtotal: 20 * 50000 + 15 * 10000 = 1,000,000 + 150,000 = 1,150,000 paise (₹11,500)
    // Tax (18%): 1,150,000 * 0.18 = 207,000 paise (₹2,070)
    // Total: 1,357,000 paise (₹13,570)
    expect(recalculatedOrder.subtotalMinor).toBe(1150000);
    expect(recalculatedOrder.taxMinor).toBe(207000);
    expect(recalculatedOrder.totalMinor).toBe(1357000);
    expect(recalculatedOrder.version).toBe(2); // Version bumped
    expect(recalculatedOrder.orderNumber).toBeNull(); // Still a draft!

    // Stock before approval
    const stockABefore = await prisma.inventoryLevel.findUnique({
      where: { organizationId_productId: { organizationId: orgId, productId: productA.id } },
    });
    const stockBBefore = await prisma.inventoryLevel.findUnique({
      where: { organizationId_productId: { organizationId: orgId, productId: productB.id } },
    });
    const reservedABefore = stockABefore?.reserved ?? 0;
    const reservedBBefore = stockBBefore?.reserved ?? 0;

    // ── STEP 3: Admin approves the order ──
    const approveRes = await approveRoute(
      new Request(`http://localhost/api/orders/${draftB.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 2, // Current bumped version
        }),
      }),
      makeContext(draftB.id),
    );

    expect(approveRes.status).toBe(200);
    const approveJson = await approveRes.json();
    expect(approveJson.approved).toBe(true);

    const approved = approveJson.order;
    expect(approved.status).toBe("APPROVED");
    expect(approved.orderNumber).toMatch(/^ORD-\d{4}$/); // Allocated orderNumber!
    expect(approved.approvedById).toBe(adminUser.id);
    expect(approved.approvedAt).toBeDefined();

    // Verify stock is now reserved via InventoryProvider
    const stockAAfter = await prisma.inventoryLevel.findUnique({
      where: { organizationId_productId: { organizationId: orgId, productId: productA.id } },
    });
    const stockBAfter = await prisma.inventoryLevel.findUnique({
      where: { organizationId_productId: { organizationId: orgId, productId: productB.id } },
    });
    expect(stockAAfter?.reserved).toBe(reservedABefore + 20);
    expect(stockBAfter?.reserved).toBe(reservedBBefore + 15);

    // Verify Fulfillment record created in PENDING status
    const fulfillment = await prisma.fulfillment.findFirst({
      where: { orderId: draftB.id },
    });
    expect(fulfillment).toBeDefined();
    expect(fulfillment?.status).toBe("PENDING");

    // Guard test: assertOrderApproved now succeeds
    expect(() => assertOrderApproved(approved)).not.toThrow();

    // Verify NO customer message was created yet (all customer updates trigger only downstream from order.approved)
    const customerMessages = await prisma.customerMessage.findMany({
      where: { organizationId: orgId },
    });
    expect(customerMessages).toHaveLength(0);

    // ── STEP 4: Admin rejects a second draft with a reason ──
    const draft2 = await prisma.order.create({
      data: {
        organizationId: orgId,
        draftNumber: "DFT-SECOND-02",
        customerId: customer.id,
        status: "DRAFT",
        totalMinor: 59000,
        subtotalMinor: 50000,
        taxMinor: 9000,
        lines: {
          create: [
            {
              organizationId: orgId,
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

    const rejectRes = await rejectRoute(
      new Request(`http://localhost/api/orders/${draft2.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Item discontinued by manufacturer",
        }),
      }),
      makeContext(draft2.id),
    );

    expect(rejectRes.status).toBe(200);
    const rejectJson = await rejectRes.json();
    expect(rejectJson.rejected).toBe(true);
    expect(rejectJson.order.status).toBe("REJECTED");
    expect(rejectJson.order.rejectedReason).toBe("Item discontinued by manufacturer");
  });
});
