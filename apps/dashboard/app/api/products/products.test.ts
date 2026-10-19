import { describe, expect, it, afterEach, vi } from "vitest";
import { prisma } from "@/app/lib/db";
import { GET as getProducts, POST as createProduct } from "./route";
import {
  PATCH as updateProduct,
  DELETE as deactivateProduct,
} from "./[id]/route";
import { POST as addAlias } from "./[id]/aliases/route";
import {
  POST as createCustomerPrice,
} from "./customer-prices/route";
import {
  POST as createDiscountRule,
} from "./discount-rules/route";

// Session mock seam
let currentSession: Record<string, unknown> | null = null;
vi.mock("@/app/lib/session", () => ({
  getSession: vi.fn(async () => currentSession),
}));

describe("Products & Catalog API", () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
      createdOrgIds.length = 0;
    }
  });

  async function createTestOrg(role = "CLIENT_ADMIN") {
    const orgId = `org_prod_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    createdOrgIds.push(orgId);

    const org = await prisma.organization.create({
      data: {
        id: orgId,
        name: "Catalog Test Org",
      },
    });

    currentSession = {
      mode: "CLIENT",
      userId: `usr_${orgId}`,
      organizationId: orgId,
      name: "Test User",
      email: "test@example.com",
      role,
    };

    return { orgId, org };
  }

  it("POST /api/products: creates a product with aliases and initial stock", async () => {
    const { orgId } = await createTestOrg("CLIENT_ADMIN");

    const req = new Request("http://localhost/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: "ANT-TEST-100",
        name: "Test Directional Antenna",
        unit: "PCS",
        basePriceMinor: 850000,
        taxRateBps: 1800,
        reorderLevel: 5,
        initialStock: 25,
        aliases: ["test antenna", "directional ant"],
      }),
    });

    const res = await createProduct(req);
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.product.sku).toBe("ANT-TEST-100");
    expect(data.product.inventoryLevel?.onHand).toBe(25);
    expect(data.product.aliases).toHaveLength(2);

    // Verify initial stock movement was logged
    const movement = await prisma.stockMovement.findFirst({
      where: { organizationId: orgId, productId: data.product.id },
    });
    expect(movement?.delta).toBe(25);
    expect(movement?.reason).toBe("ADJUSTMENT");
  });

  it("CRITICAL: enforces ALIAS UNIQUENESS per organization (case-insensitive) with 409 Conflict", async () => {
    const { orgId } = await createTestOrg("CLIENT_ADMIN");

    // 1. Create first product with alias "outdoor antenna"
    await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: "PROD-ALPHA",
        name: "Alpha Antenna",
        basePriceMinor: 5000,
        aliases: {
          create: [{ organizationId: orgId, alias: "outdoor antenna" }],
        },
      },
    });

    // 2. Create second product
    const p2 = await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: "PROD-BETA",
        name: "Beta Antenna",
        basePriceMinor: 6000,
      },
    });

    // 3. Attempt to add duplicate alias "Outdoor Antenna" (case variation) to second product
    const aliasReq = new Request(`http://localhost/api/products/${p2.id}/aliases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias: "Outdoor Antenna" }),
    });

    const res = await addAlias(aliasReq, { params: Promise.resolve({ id: p2.id }) });
    expect(res.status).toBe(409);
    const err = await res.json();
    expect(err.code).toBe("ALIAS_ALREADY_EXISTS");
    expect(err.error).toMatch(/already exists and is assigned to SKU "PROD-ALPHA"/);
  });

  it("GET /api/products: filters and searches products within tenant", async () => {
    const { orgId } = await createTestOrg();

    await prisma.product.createMany({
      data: [
        {
          organizationId: orgId,
          sku: "CAB-LMR200",
          name: "Coaxial Cable 5m",
          basePriceMinor: 150000,
          isActive: true,
        },
        {
          organizationId: orgId,
          sku: "CON-SMA-M",
          name: "SMA Male Connector",
          basePriceMinor: 25000,
          isActive: false,
        },
      ],
    });

    // Search by SKU substring
    const searchReq = new Request("http://localhost/api/products?search=LMR200");
    const searchRes = await getProducts(searchReq);
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    expect(searchData.products).toHaveLength(1);
    expect(searchData.products[0].sku).toBe("CAB-LMR200");

    // Filter by isActive=true
    const activeReq = new Request("http://localhost/api/products?isActive=true");
    const activeRes = await getProducts(activeReq);
    const activeData = await activeRes.json();
    expect(activeData.products).toHaveLength(1);
    expect(activeData.products[0].sku).toBe("CAB-LMR200");
  });

  it("PATCH & DELETE: updates attributes and deactivates product", async () => {
    const { orgId } = await createTestOrg();

    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: "AMP-TEST",
        name: "Original Name",
        basePriceMinor: 40000,
      },
    });

    // Update
    const patchReq = new Request(`http://localhost/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Amplifier Name", basePriceMinor: 45000 }),
    });
    const patchRes = await updateProduct(patchReq, {
      params: Promise.resolve({ id: product.id }),
    });
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.product.name).toBe("Updated Amplifier Name");
    expect(patchData.product.basePriceMinor).toBe(45000);

    // Deactivate
    const delReq = new Request(`http://localhost/api/products/${product.id}`, {
      method: "DELETE",
    });
    const delRes = await deactivateProduct(delReq, {
      params: Promise.resolve({ id: product.id }),
    });
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.deactivated).toBe(true);
    expect(delData.product.isActive).toBe(false);
  });

  it("CRUD for CustomerPrice and DiscountRule", async () => {
    const { orgId } = await createTestOrg();

    const customer = await prisma.customer.create({
      data: {
        organizationId: orgId,
        name: "Enterprise Buyer Corp",
        tagsJson: "[]",
      },
    });

    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        sku: "MOD-WIFI-6",
        name: "Wi-Fi 6 Module",
        basePriceMinor: 100000,
      },
    });

    // Create CustomerPrice
    const cpReq = new Request("http://localhost/api/products/customer-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        productId: product.id,
        priceMinor: 85000, // Contract discount
      }),
    });
    const cpRes = await createCustomerPrice(cpReq);
    expect(cpRes.status).toBe(200);
    const cpData = await cpRes.json();
    expect(cpData.customerPrice.priceMinor).toBe(85000);

    // Create DiscountRule
    const drReq = new Request("http://localhost/api/products/discount-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "PRODUCT",
        productId: product.id,
        type: "PERCENT",
        value: 15,
        minQty: 10,
      }),
    });
    const drRes = await createDiscountRule(drReq);
    expect(drRes.status).toBe(201);
    const drData = await drRes.json();
    expect(drData.discountRule.value).toBe(15);
    expect(drData.discountRule.minQty).toBe(10);
  });

  it("ROLE AUTHORIZATION: rejects non-admin users (MEMBER) with 403 Forbidden", async () => {
    await createTestOrg("MEMBER"); // Non-admin role

    const req = new Request("http://localhost/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: "FORBIDDEN-SKU",
        name: "Unauthorized Item",
        basePriceMinor: 1000,
      }),
    });

    const res = await createProduct(req);
    expect(res.status).toBe(403);
    const err = await res.json();
    expect(err.error).toMatch(/Forbidden: CLIENT_ADMIN or ADMIN role required/);
  });
});
