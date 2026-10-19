import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const orderFindMany = vi.fn();
  const orderFindFirst = vi.fn();
  const orderCreate = vi.fn();
  const orderUpdate = vi.fn();
  const orderEventCreate = vi.fn();
  const orgCounterUpsert = vi.fn(async () => ({ nextValue: 2 }));
  const auditLogCreate = vi.fn();
  const publishToChannel = vi.fn(async () => true);

  return {
    getSession,
    publishToChannel,
    prisma: {
      order: {
        findMany: orderFindMany,
        findFirst: orderFindFirst,
        create: orderCreate,
        update: orderUpdate,
      },
      orderEvent: {
        create: orderEventCreate,
      },
      orgCounter: {
        upsert: orgCounterUpsert,
      },
      auditLog: {
        create: auditLogCreate,
      },
      customer: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(async (cb: ((tx: unknown) => unknown) | Promise<unknown>[]) => {
        if (typeof cb === "function") {
          return cb({
            order: {
              findFirst: orderFindFirst,
              create: orderCreate,
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

vi.mock("@/app/lib/realtime/server", () => ({
  publishToChannel: h.publishToChannel,
}));

vi.mock("@/app/lib/audit", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

vi.mock("@/app/lib/analytics", () => ({
  trackEvent: vi.fn(async () => {}),
}));

import { GET as listOrders, POST as createNewOrder } from "./route";
import { GET as getOrderDetail } from "./[id]/route";

function sessionFor(organizationId: string, role = "CLIENT_ADMIN") {
  return {
    mode: "CLIENT",
    userId: "usr_admin_1",
    organizationId,
    name: "Admin User",
    email: "admin@example.com",
    role,
  };
}

describe("API: /api/orders (List & Create)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/orders", () => {
    it("enforces authentication (401 when unauthenticated)", async () => {
      h.getSession.mockResolvedValue(null);
      const res = await listOrders(new Request("http://localhost/api/orders"));
      expect(res.status).toBe(401);
    });

    it("scopes query strictly to session.organizationId", async () => {
      h.getSession.mockResolvedValue(sessionFor("org_acme"));
      h.prisma.order.findMany.mockResolvedValue([
        {
          id: "ord_1",
          orderNumber: "ORD-0001",
          draftNumber: "DFT-0001",
          organizationId: "org_acme",
          status: "DRAFT",
          totalMinor: 11800,
          customer: { name: "Alice", company: "Acme Corp" },
          lines: [],
        },
      ]);

      const res = await listOrders(new Request("http://localhost/api/orders?status=DRAFT"));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.orders).toHaveLength(1);
      expect(json.orders[0].id).toBe("ord_1");

      // Verify Prisma call was strictly tenant-scoped
      expect(h.prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org_acme",
            status: "DRAFT",
          }),
        }),
      );
    });
  });

  describe("POST /api/orders", () => {
    it("validates required payload fields (customerId, items)", async () => {
      h.getSession.mockResolvedValue(sessionFor("org_acme"));

      const resNoCustomer = await createNewOrder(
        new Request("http://localhost/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [] }),
        }),
      );
      expect(resNoCustomer.status).toBe(400);

      const resNoItems = await createNewOrder(
        new Request("http://localhost/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: "cust_1", items: [] }),
        }),
      );
      expect(resNoItems.status).toBe(400);
    });

    it("creates a draft order with sequential draftNumber in integer minor units", async () => {
      h.getSession.mockResolvedValue(sessionFor("org_acme"));

      const createdOrder = {
        id: "ord_created_1",
        draftNumber: "DFT-0001",
        orderNumber: null,
        organizationId: "org_acme",
        customerId: "cust_1",
        status: "DRAFT",
        currency: "INR",
        subtotalMinor: 10000,
        taxMinor: 1800,
        totalMinor: 11800,
        lines: [
          {
            id: "line_1",
            sku: "SKU-TEST",
            name: "Test Product",
            qty: 1,
            unitPriceMinor: 10000,
            lineTotalMinor: 10000,
          },
        ],
        events: [],
      };

      h.prisma.order.create.mockResolvedValue(createdOrder);

      const res = await createNewOrder(
        new Request("http://localhost/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: "cust_1",
            items: [
              {
                sku: "SKU-TEST",
                name: "Test Product",
                quantity: 1,
                unitPricePaise: 10000,
              },
            ],
          }),
        }),
      );

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.order.id).toBe("ord_created_1");
      expect(json.order.totalMinor).toBe(11800);
      expect(json.order.draftNumber).toBe("DFT-0001");

      // Verify integer minor units stored in prisma.order.create
      expect(h.prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: "org_acme",
            subtotalMinor: 10000,
            taxMinor: 1800,
            totalMinor: 11800,
            draftNumber: "DFT-0001",
          }),
        }),
      );
    });
  });
});

describe("API: /api/orders/:id (Order Detail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for an order belonging to a different tenant", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_acme"));
    h.prisma.order.findFirst.mockResolvedValue(null);

    const res = await getOrderDetail(
      new Request("http://localhost/api/orders/ord_other_tenant"),
      { params: Promise.resolve({ id: "ord_other_tenant" }) },
    );

    expect(res.status).toBe(404);
    expect(h.prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "ord_other_tenant",
          organizationId: "org_acme",
        },
      }),
    );
  });

  it("returns order detail when tenant matches", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_acme"));
    const orderData = {
      id: "ord_my_tenant",
      organizationId: "org_acme",
      orderNumber: "ORD-0001",
      draftNumber: "DFT-0001",
      status: "APPROVED",
      subtotalMinor: 5000,
      taxMinor: 900,
      totalMinor: 5900,
      customer: { name: "Bob", company: "Bob Inc" },
      lines: [],
      events: [],
    };
    h.prisma.order.findFirst.mockResolvedValue(orderData);

    const res = await getOrderDetail(
      new Request("http://localhost/api/orders/ord_my_tenant"),
      { params: Promise.resolve({ id: "ord_my_tenant" }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.order.id).toBe("ord_my_tenant");
  });
});
