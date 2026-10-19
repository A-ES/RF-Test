import { describe, expect, it, afterEach } from "vitest";
import { prisma } from "@/app/lib/db";
import {
  LocalDbInventoryProvider,
  ErpInventoryProvider,
  ZeroFloorViolationError,
  InsufficientStockError,
  ErpNotConfiguredError,
} from "./provider";

describe("InventoryProvider & LocalDbInventoryProvider (ERP Seam)", () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    // Clean up test organizations
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
      createdOrgIds.length = 0;
    }
  });

  async function createTestOrg(allowBackorders = false) {
    const orgId = `org_inv_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    createdOrgIds.push(orgId);

    await prisma.organization.create({
      data: {
        id: orgId,
        name: "Inventory Test Org",
        settings: {
          create: {
            featureFlagsJson: JSON.stringify({ allowBackorder: allowBackorders }),
          },
        },
      },
    });

    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: "TEST-SKU-001",
        name: "Test Hardware Item",
        basePriceMinor: 10000,
        unit: "PCS",
        inventoryLevel: {
          create: {
            organizationId: orgId,
            onHand: 15,
            reserved: 3,
          },
        },
      },
      include: {
        inventoryLevel: true,
      },
    });

    return { orgId, product };
  }

  it("getStock: returns onHand, reserved, and available = onHand - reserved", async () => {
    const { orgId, product } = await createTestOrg();
    const provider = new LocalDbInventoryProvider();

    const stock = await provider.getStock(orgId, product.id);
    expect(stock.onHand).toBe(15);
    expect(stock.reserved).toBe(3);
    expect(stock.available).toBe(12);
  });

  it("adjust: updates stock level and writes a StockMovement atomically", async () => {
    const { orgId, product } = await createTestOrg();
    const provider = new LocalDbInventoryProvider();

    const updated = await provider.adjust(orgId, product.id, 5, {
      reason: "ADJUSTMENT",
      notes: "Received incoming batch",
    });

    expect(updated.onHand).toBe(20);
    expect(updated.reserved).toBe(3);
    expect(updated.available).toBe(17);

    // Verify StockMovement record in database
    const movement = await prisma.stockMovement.findFirst({
      where: { organizationId: orgId, productId: product.id },
      orderBy: { createdAt: "desc" },
    });

    expect(movement).not.toBeNull();
    expect(movement?.delta).toBe(5);
    expect(movement?.reason).toBe("ADJUSTMENT");
  });

  it("CRITICAL ZERO-FLOOR RULE: throws ZeroFloorViolationError when adjustment results in negative stock", async () => {
    const { orgId, product } = await createTestOrg(false); // Backorders DISABLED
    const provider = new LocalDbInventoryProvider();

    // Current onHand is 15. Attempting delta of -20 would result in -5.
    await expect(
      provider.adjust(orgId, product.id, -20, {
        reason: "ADJUSTMENT",
      }),
    ).rejects.toThrow(ZeroFloorViolationError);

    // Verify onHand was NOT modified (rolled back)
    const stockAfter = await provider.getStock(orgId, product.id);
    expect(stockAfter.onHand).toBe(15);

    // Verify NO stock movement was committed
    const movementCount = await prisma.stockMovement.count({
      where: { organizationId: orgId, productId: product.id },
    });
    expect(movementCount).toBe(0);
  });

  it("permits negative stock when the organization explicitly enables backorders", async () => {
    const { orgId, product } = await createTestOrg(true); // Backorders ENABLED
    const provider = new LocalDbInventoryProvider();

    // Delta of -20 results in onHand = -5
    const updated = await provider.adjust(orgId, product.id, -20, {
      reason: "ADJUSTMENT",
    });

    expect(updated.onHand).toBe(-5);
    expect(updated.available).toBe(-8);

    const movement = await prisma.stockMovement.findFirst({
      where: { organizationId: orgId, productId: product.id },
    });
    expect(movement?.delta).toBe(-20);
  });

  it("reserve: reserves available stock and cannot drop available below zero without backorders", async () => {
    const { orgId, product } = await createTestOrg(false);
    const provider = new LocalDbInventoryProvider();

    // Available is 12. Reserving 10 is allowed.
    await provider.reserve(orgId, product.id, 10);
    const stockAfter = await provider.getStock(orgId, product.id);
    expect(stockAfter.reserved).toBe(13); // 3 + 10
    expect(stockAfter.available).toBe(2);  // 15 - 13

    // Reserving 5 more exceeds remaining available (2) -> must throw InsufficientStockError
    await expect(provider.reserve(orgId, product.id, 5)).rejects.toThrow(
      InsufficientStockError,
    );
  });

  it("commit: deducts onHand and writes FULFILLMENT movement", async () => {
    const { orgId, product } = await createTestOrg(false);
    const provider = new LocalDbInventoryProvider();

    await provider.commit(orgId, product.id, 5);

    const stockAfter = await provider.getStock(orgId, product.id);
    expect(stockAfter.onHand).toBe(10); // 15 - 5

    const movement = await prisma.stockMovement.findFirst({
      where: { organizationId: orgId, productId: product.id, reason: "FULFILLMENT" },
    });
    expect(movement?.delta).toBe(-5);
  });

  it("ErpInventoryProvider: throws clear 'not configured' error", async () => {
    // With no ERP config in environment
    const prevUrl = process.env.ERP_INVENTORY_URL;
    const prevKey = process.env.ERP_API_KEY;
    delete process.env.ERP_INVENTORY_URL;
    delete process.env.ERP_API_KEY;

    try {
      const erp = new ErpInventoryProvider();
      await expect(erp.getStock("org_1", "prod_1")).rejects.toThrow(
        ErpNotConfiguredError,
      );
      await expect(erp.getStock("org_1", "prod_1")).rejects.toThrow(
        /ERP inventory provider is not configured: missing ERP_INVENTORY_URL or ERP_API_KEY/,
      );
    } finally {
      if (prevUrl) process.env.ERP_INVENTORY_URL = prevUrl;
      if (prevKey) process.env.ERP_API_KEY = prevKey;
    }
  });
});
