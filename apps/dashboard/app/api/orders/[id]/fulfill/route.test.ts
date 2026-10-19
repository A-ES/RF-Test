import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const orderFindFirst = vi.fn();
  const orderUpdate = vi.fn();
  const orderEventCreate = vi.fn();
  const inventoryLevelFindUnique = vi.fn();
  const inventoryLevelUpdate = vi.fn();
  const stockMovementCreate = vi.fn();
  const fulfillmentCreate = vi.fn();
  const writeAuditLog = vi.fn(async () => {});
  const trackEvent = vi.fn(async () => {});
  const publishToChannel = vi.fn(async () => true);

  return {
    getSession,
    writeAuditLog,
    trackEvent,
    publishToChannel,
    prisma: {
      order: {
        findFirst: orderFindFirst,
        update: orderUpdate,
      },
      orderEvent: {
        create: orderEventCreate,
      },
      inventoryLevel: {
        findUnique: inventoryLevelFindUnique,
        update: inventoryLevelUpdate,
      },
      stockMovement: {
        create: stockMovementCreate,
      },
      fulfillment: {
        create: fulfillmentCreate,
      },
      $transaction: vi.fn(async (cb: ((tx: unknown) => unknown) | Promise<unknown>[]) => {
        if (typeof cb === "function") {
          return cb({
            order: {
              findFirst: orderFindFirst,
              update: orderUpdate,
            },
            orderEvent: {
              create: orderEventCreate,
            },
            inventoryLevel: {
              findUnique: inventoryLevelFindUnique,
              update: inventoryLevelUpdate,
            },
            stockMovement: {
              create: stockMovementCreate,
            },
            fulfillment: {
              create: fulfillmentCreate,
            },
          });
        }
        return Promise.all(cb);
      }),
    },
  };
});

vi.mock("@/app/lib/session", () => ({
  getSession: h.getSession,
}));

vi.mock("@/app/lib/db", () => ({
  prisma: h.prisma,
}));

vi.mock("@/app/lib/audit", () => ({
  writeAuditLog: h.writeAuditLog,
}));

vi.mock("@/app/lib/analytics", () => ({
  trackEvent: h.trackEvent,
}));

vi.mock("@/app/lib/realtime/server", () => ({
  publishToChannel: h.publishToChannel,
}));

import { POST as fulfillRoute } from "./route";

function makeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/orders/:id/fulfill (Rule 1 & Inventory Deduction Guardrail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Rule 1: REJECTS fulfillment of unapproved draft order with HTTP 412 (Precondition Failed)", async () => {
    h.getSession.mockResolvedValue({
      userId: "usr_client_admin",
      organizationId: "org_test",
      role: "CLIENT_ADMIN",
      name: "Client Admin",
      email: "clientadmin@example.com",
    });

    const unapprovedOrder = {
      id: "ord_unapproved",
      draftNumber: "DFT-0001",
      orderNumber: null,
      organizationId: "org_test",
      status: "DRAFT",
      approvedById: null,
      approvedAt: null,
      lines: [
        {
          id: "line_1",
          productId: "prod_1",
          sku: "ANT-5G-EXT-400",
          qty: 5,
        },
      ],
    };

    h.prisma.order.findFirst.mockResolvedValue(unapprovedOrder);

    const res = await fulfillRoute(
      new Request("http://localhost/api/orders/ord_unapproved/fulfill", { method: "POST" }),
      makeContext("ord_unapproved"),
    );

    expect(res.status).toBe(412);
    const json = await res.json();
    expect(json.code).toBe("ORDER_NOT_APPROVED");
    expect(json.error).toMatch(/has not been explicitly approved/i);

    // Verify inventory was NEVER modified
    expect(h.prisma.inventoryLevel.update).not.toHaveBeenCalled();
    expect(h.prisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it("permits fulfillment of APPROVED order and atomically deducts stock", async () => {
    h.getSession.mockResolvedValue({
      userId: "usr_client_admin",
      organizationId: "org_test",
      role: "CLIENT_ADMIN",
      name: "Client Admin",
      email: "clientadmin@example.com",
    });

    const approvedOrder = {
      id: "ord_approved",
      draftNumber: "DFT-0001",
      orderNumber: "ORD-0001",
      organizationId: "org_test",
      status: "APPROVED",
      approvedById: "usr_approver",
      approvedAt: new Date("2026-10-12T10:00:00Z"),
      lines: [
        {
          id: "line_1",
          productId: "prod_1",
          sku: "ANT-5G-EXT-400",
          qty: 5,
        },
      ],
      events: [],
    };

    h.prisma.order.findFirst.mockResolvedValue(approvedOrder);

    // Existing stock: 20 on hand
    h.prisma.inventoryLevel.findUnique.mockResolvedValue({
      id: "stock_1",
      productId: "prod_1",
      onHand: 20,
      reserved: 0,
    });

    const fulfilledOrder = {
      ...approvedOrder,
      status: "DISPATCHED",
    };
    h.prisma.order.update.mockResolvedValue(fulfilledOrder);

    const res = await fulfillRoute(
      new Request("http://localhost/api/orders/ord_approved/fulfill", { method: "POST" }),
      makeContext("ord_approved"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fulfilled).toBe(true);

    // Verify inventory onHand was decremented: decrement: 5
    expect(h.prisma.inventoryLevel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "stock_1" },
        data: { onHand: { decrement: 5 } },
      }),
    );

    // Verify StockMovement was created
    expect(h.prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "prod_1",
          delta: -5,
          reason: "FULFILLMENT",
          orderId: "ord_approved",
        }),
      }),
    );

    // Verify OrderEvent was created
    expect(h.prisma.orderEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: "ord_approved",
          type: "FULFILLED",
          fromStatus: "APPROVED",
          toStatus: "DISPATCHED",
          actorKind: "EMPLOYEE",
        }),
      }),
    );
  });
});
