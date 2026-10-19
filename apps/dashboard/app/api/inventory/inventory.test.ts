import { describe, expect, it, afterEach, vi } from "vitest";
import { prisma } from "@/app/lib/db";
import { GET as getInventoryOverview } from "./route";
import {
  GET as getAdjustments,
  POST as createAdjustment,
} from "./adjustments/route";

let currentSession: Record<string, unknown> | null = null;
vi.mock("@/app/lib/session", () => ({
  getSession: vi.fn(async () => currentSession),
}));

describe("Inventory API & Stock Adjustments", () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
      createdOrgIds.length = 0;
    }
  });

  async function createTestOrg(role = "CLIENT_ADMIN", allowBackorders = false) {
    const orgId = `org_inv_api_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    createdOrgIds.push(orgId);

    await prisma.organization.create({
      data: {
        id: orgId,
        name: "Inventory API Org",
        settings: {
          create: {
            featureFlagsJson: JSON.stringify({ allowBackorder: allowBackorders }),
          },
        },
      },
    });

    currentSession = {
      mode: "CLIENT",
      userId: `usr_${orgId}`,
      organizationId: orgId,
      name: "Inventory Manager",
      email: "inv@example.com",
      role,
    };

    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: "TEST-LNA-10",
        name: "Low Noise Amplifier",
        basePriceMinor: 50000,
        reorderLevel: 8,
        inventoryLevel: {
          create: {
            organizationId: orgId,
            onHand: 10,
            reserved: 2,
          },
        },
      },
    });

    return { orgId, product };
  }

  it("GET /api/inventory: returns catalog stock overview and KPIs", async () => {
    await createTestOrg();

    const req = new Request("http://localhost/api/inventory");
    const res = await getInventoryOverview(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.items[0].sku).toBe("TEST-LNA-10");
    expect(data.items[0].onHand).toBe(10);
    expect(data.items[0].reserved).toBe(2);
    expect(data.items[0].available).toBe(8);
    expect(data.kpis.totalOnHand).toBe(10);
    expect(data.kpis.totalAvailable).toBe(8);
  });

  it("POST /api/inventory/adjustments: updates stock and records movement in one transaction", async () => {
    const { orgId, product } = await createTestOrg();

    const req = new Request("http://localhost/api/inventory/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        delta: 15,
        reason: "ADJUSTMENT",
        notes: "Count reconciled",
      }),
    });

    const res = await createAdjustment(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.stock.onHand).toBe(25); // 10 + 15
    expect(data.stock.available).toBe(23); // 25 - 2

    // Verify movement in database
    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: orgId, productId: product.id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(15);
    expect(movements[0].reason).toBe("ADJUSTMENT");
  });

  it("CRITICAL ZERO FLOOR RULE: rejects adjustment that reduces stock below zero with HTTP 400", async () => {
    const { orgId, product } = await createTestOrg("CLIENT_ADMIN", false); // Backorders disabled

    // Current onHand is 10. Requesting delta of -15 would result in -5.
    const req = new Request("http://localhost/api/inventory/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        delta: -15,
        reason: "ADJUSTMENT",
      }),
    });

    const res = await createAdjustment(req);
    expect(res.status).toBe(400);
    const err = await res.json();

    expect(err.code).toBe("ZERO_FLOOR_VIOLATION");
    expect(err.error).toMatch(/Cannot adjust inventory below zero/);

    // Verify database onHand was NOT modified
    const level = await prisma.inventoryLevel.findUnique({
      where: { organizationId_productId: { organizationId: orgId, productId: product.id } },
    });
    expect(level?.onHand).toBe(10);
  });

  it("GET /api/inventory/adjustments: lists stock movements audit trail", async () => {
    const { orgId, product } = await createTestOrg();

    // Create a movement
    await prisma.stockMovement.create({
      data: {
        organizationId: orgId,
        productId: product.id,
        delta: 7,
        reason: "ERP_SYNC",
        actorId: "usr_sync",
      },
    });

    const req = new Request("http://localhost/api/inventory/adjustments");
    const res = await getAdjustments(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.movements.length).toBeGreaterThanOrEqual(1);
    expect(data.movements[0].delta).toBe(7);
    expect(data.movements[0].reason).toBe("ERP_SYNC");
    expect(data.movements[0].product.sku).toBe("TEST-LNA-10");
  });

  it("ROLE AUTHORIZATION: rejects non-admin users (MEMBER) on adjustments with 403 Forbidden", async () => {
    const { product } = await createTestOrg("MEMBER"); // Non-admin

    const req = new Request("http://localhost/api/inventory/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        delta: 5,
        reason: "ADJUSTMENT",
      }),
    });

    const res = await createAdjustment(req);
    expect(res.status).toBe(403);
    const err = await res.json();
    expect(err.error).toMatch(/Forbidden: CLIENT_ADMIN or ADMIN role required/);
  });
});
