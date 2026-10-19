import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const orderFindFirst = vi.fn();
  const orderUpdate = vi.fn();
  const orderEventCreate = vi.fn();
  const orgCounterUpsert = vi.fn(async () => ({ nextValue: 1002 }));
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
      orgCounter: {
        upsert: orgCounterUpsert,
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
            orgCounter: {
              upsert: orgCounterUpsert,
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

import { POST as approveRoute } from "./route";

function makeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/orders/:id/approve (Approval Guardrail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests with 401", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await approveRoute(
      new Request("http://localhost/api/orders/ord_1/approve", { method: "POST" }),
      makeContext("ord_1"),
    );
    expect(res.status).toBe(401);
  });

  it("Rule 1: strictly rejects non-admin roles (e.g. MEMBER) with 403", async () => {
    h.getSession.mockResolvedValue({
      userId: "usr_member",
      organizationId: "org_test",
      role: "MEMBER",
      name: "Standard Member",
      email: "member@example.com",
    });

    const res = await approveRoute(
      new Request("http://localhost/api/orders/ord_1/approve", { method: "POST" }),
      makeContext("ord_1"),
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/Only CLIENT_ADMIN or ADMIN/i);
  });

  it("returns 404 if order does not exist or belongs to another tenant", async () => {
    h.getSession.mockResolvedValue({
      userId: "usr_admin",
      organizationId: "org_test",
      role: "CLIENT_ADMIN",
      name: "Admin User",
      email: "admin@example.com",
    });

    h.prisma.order.findFirst.mockResolvedValue(null);

    const res = await approveRoute(
      new Request("http://localhost/api/orders/ord_missing/approve", { method: "POST" }),
      makeContext("ord_missing"),
    );

    expect(res.status).toBe(404);
  });

  it("successfully approves order when called by CLIENT_ADMIN and updates DB with event", async () => {
    h.getSession.mockResolvedValue({
      userId: "usr_client_admin",
      organizationId: "org_test",
      role: "CLIENT_ADMIN",
      name: "Client Admin",
      email: "clientadmin@example.com",
    });

    const draftOrder = {
      id: "ord_draft_1",
      orderNumber: null,
      draftNumber: "DFT-0001",
      organizationId: "org_test",
      status: "DRAFT",
      customerId: "cust_1",
      subtotalMinor: 10000,
      taxMinor: 1800,
      totalMinor: 11800,
      currency: "INR",
      approvedById: null,
      approvedAt: null,
      lines: [],
      events: [],
    };

    h.prisma.order.findFirst.mockResolvedValue(draftOrder);

    const updatedOrder = {
      ...draftOrder,
      orderNumber: "ORD-1001",
      status: "APPROVED",
      approvedById: "usr_client_admin",
      approvedAt: new Date(),
    };

    h.prisma.order.update.mockResolvedValue(updatedOrder);

    const res = await approveRoute(
      new Request("http://localhost/api/orders/ord_draft_1/approve", { method: "POST" }),
      makeContext("ord_draft_1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.approved).toBe(true);
    expect(json.order.status).toBe("APPROVED");

    // Verify update occurred with approvedById and orderNumber set
    expect(h.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ord_draft_1" },
        data: expect.objectContaining({
          status: "APPROVED",
          approvedById: "usr_client_admin",
          orderNumber: "ORD-1001",
        }),
      }),
    );

    // Verify OrderEvent was created
    expect(h.prisma.orderEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: "ord_draft_1",
          type: "APPROVED",
          fromStatus: "DRAFT",
          toStatus: "APPROVED",
          actorKind: "EMPLOYEE",
        }),
      }),
    );

    // Verify audit log and analytics tracking
    expect(h.writeAuditLog).toHaveBeenCalled();
    expect(h.trackEvent).toHaveBeenCalled();
  });
});
