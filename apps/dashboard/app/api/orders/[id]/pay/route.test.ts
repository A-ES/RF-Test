import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const orderFindFirst = vi.fn();
  const orderUpdate = vi.fn();
  const orderEventCreate = vi.fn();
  const paymentCreate = vi.fn();
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
      payment: {
        create: paymentCreate,
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
            payment: {
              create: paymentCreate,
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

import { POST as payRoute } from "./route";

function makeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/orders/:id/pay (Payment & Rule 1 Guardrail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Rule 1: REJECTS payment for unapproved order with HTTP 412 (Precondition Failed)", async () => {
    h.getSession.mockResolvedValue({
      userId: "usr_client_admin",
      organizationId: "org_test",
      role: "CLIENT_ADMIN",
      name: "Client Admin",
      email: "clientadmin@example.com",
    });

    const unapprovedOrder = {
      id: "ord_draft_payment",
      draftNumber: "DFT-0001",
      orderNumber: null,
      organizationId: "org_test",
      status: "DRAFT",
      approvedById: null,
      approvedAt: null,
      totalMinor: 50000,
      lines: [],
      events: [],
    };

    h.prisma.order.findFirst.mockResolvedValue(unapprovedOrder);

    const res = await payRoute(
      new Request("http://localhost/api/orders/ord_draft_payment/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentReference: "UPI-REF-12345" }),
      }),
      makeContext("ord_draft_payment"),
    );

    expect(res.status).toBe(412);
    const json = await res.json();
    expect(json.code).toBe("ORDER_NOT_APPROVED");
    expect(json.error).toMatch(/has not been explicitly approved/i);
    expect(h.prisma.order.update).not.toHaveBeenCalled();
  });

  it("validates paymentReference is required", async () => {
    h.getSession.mockResolvedValue({
      userId: "usr_client_admin",
      organizationId: "org_test",
      role: "CLIENT_ADMIN",
      name: "Client Admin",
      email: "clientadmin@example.com",
    });

    const res = await payRoute(
      new Request("http://localhost/api/orders/ord_1/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentReference: "" }),
      }),
      makeContext("ord_1"),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/paymentReference is required/i);
  });

  it("permits payment for APPROVED order and updates paymentStatus to PAID", async () => {
    h.getSession.mockResolvedValue({
      userId: "usr_client_admin",
      organizationId: "org_test",
      role: "CLIENT_ADMIN",
      name: "Client Admin",
      email: "clientadmin@example.com",
    });

    const approvedOrder = {
      id: "ord_approved_pay",
      orderNumber: "ORD-0555",
      draftNumber: "DFT-0555",
      organizationId: "org_test",
      status: "APPROVED",
      paymentStatus: "UNPAID",
      totalMinor: 50000,
      approvedById: "usr_approver",
      approvedAt: new Date("2026-10-12T10:00:00Z"),
      lines: [],
      events: [],
    };

    h.prisma.order.findFirst.mockResolvedValue(approvedOrder);

    const paidOrder = {
      ...approvedOrder,
      paymentStatus: "PAID",
    };
    h.prisma.order.update.mockResolvedValue(paidOrder);
    h.prisma.payment.create.mockResolvedValue({
      id: "pay_123",
      amountMinor: 50000,
      status: "SUCCESS",
    });

    const res = await payRoute(
      new Request("http://localhost/api/orders/ord_approved_pay/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentReference: "RAZORPAY-PAY-987" }),
      }),
      makeContext("ord_approved_pay"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.paid).toBe(true);

    expect(h.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ord_approved_pay" },
        data: expect.objectContaining({
          paymentStatus: "PAID",
        }),
      }),
    );

    expect(h.prisma.orderEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: "ord_approved_pay",
          type: "PAID",
          fromStatus: "APPROVED",
          toStatus: "APPROVED",
          actorKind: "EMPLOYEE",
        }),
      }),
    );
  });
});
