import { describe, expect, it, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/app/lib/db";
import { POST as importProducts, parseCsv, validateAndNormalizeCsvRows } from "./import/route";

let currentSession: Record<string, unknown> | null = null;
vi.mock("@/app/lib/session", () => ({
  getSession: vi.fn(async () => currentSession),
}));

describe("CSV Import for Products & Stock", () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
      createdOrgIds.length = 0;
    }
  });

  async function createTestOrg() {
    const orgId = `org_csv_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    createdOrgIds.push(orgId);

    await prisma.organization.create({
      data: {
        id: orgId,
        name: "CSV Import Test Org",
      },
    });

    currentSession = {
      mode: "CLIENT",
      userId: `usr_${orgId}`,
      organizationId: orgId,
      name: "Importer",
      email: "importer@example.com",
      role: "CLIENT_ADMIN",
    };

    return { orgId };
  }

  it("parseCsv: handles quoted fields with commas and escaped quotes", () => {
    const csv = `sku,name,description,price\nANT-1,"Panel Antenna, 5GHz","Dual-polarization ""Heavy Duty""",12000`;
    const { headers, rows } = parseCsv(csv);

    expect(headers).toContain("sku");
    expect(headers).toContain("name");
    expect(headers).toContain("description");
    expect(headers).toContain("price");

    expect(rows).toHaveLength(1);
    expect(rows[0]["name"]).toBe("Panel Antenna, 5GHz");
    expect(rows[0]["description"]).toBe('Dual-polarization "Heavy Duty"');
    expect(rows[0]["price"]).toBe("12000");
  });

  it("validateAndNormalizeCsvRows: collects row-level errors for missing fields, negative prices and duplicate SKUs", async () => {
    const { orgId } = await createTestOrg();

    const invalidRows = [
      { sku: "", name: "No SKU Item", price: "100" }, // missing SKU
      { sku: "SKU-2", name: "", price: "100" },       // missing name
      { sku: "SKU-3", name: "Bad Price", price: "-50" }, // negative price
      { sku: "SKU-4", name: "First Entry", price: "200" },
      { sku: "SKU-4", name: "Duplicate Entry", price: "200" }, // duplicate SKU in file
    ];

    const { validRows, errors } = await validateAndNormalizeCsvRows(invalidRows, orgId);

    expect(validRows).toHaveLength(1); // Only SKU-4 first entry is valid
    expect(errors).toHaveLength(4);

    expect(errors.find((e) => e.field === "sku" && e.message.includes("required"))?.row).toBe(2);
    expect(errors.find((e) => e.field === "name")?.row).toBe(3);
    expect(errors.find((e) => e.field === "price")?.row).toBe(4);
    expect(errors.find((e) => e.message.includes("Duplicate SKU"))?.row).toBe(6);
  });

  it("DRY RUN PREVIEW: returns row-level preview without creating any database records", async () => {
    const { orgId } = await createTestOrg();

    const csvContent = `sku,name,unit,price,stock\nANT-DRY-01,Dry Run Antenna,PCS,5000,10`;
    const req = new Request("http://localhost/api/products/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent, dryRun: true }),
    });

    const res = await importProducts(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.dryRun).toBe(true);
    expect(data.validCount).toBe(1);
    expect(data.errorCount).toBe(0);
    expect(data.preview[0].action).toBe("CREATE");
    expect(data.preview[0].sku).toBe("ANT-DRY-01");

    // Verify nothing was written to DB
    const count = await prisma.product.count({ where: { organizationId: orgId } });
    expect(count).toBe(0);
  });

  it("LIVE IMPORT: creates new products, updates existing products by SKU, and imports seed CSV cleanly", async () => {
    const { orgId } = await createTestOrg();

    // Read the actual seed CSV file
    const seedCsvPath = path.resolve(process.cwd(), "public", "seed-products.csv");
    const seedCsvContent = fs.readFileSync(seedCsvPath, "utf-8");

    // 1. First run: Import all 12 products
    const req1 = new Request("http://localhost/api/products/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent: seedCsvContent, dryRun: false }),
    });

    const res1 = await importProducts(req1);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();

    expect(data1.created).toBe(12);
    expect(data1.updated).toBe(0);
    expect(data1.total).toBe(12);

    // Verify products, inventory, and stock movements in DB
    const productsInDb = await prisma.product.findMany({
      where: { organizationId: orgId },
      include: { inventoryLevel: true, aliases: true },
    });
    expect(productsInDb).toHaveLength(12);

    const ant5g = productsInDb.find((p) => p.sku === "ANT-5G-EXT-400");
    expect(ant5g).toBeDefined();
    expect(ant5g?.inventoryLevel?.onHand).toBe(45);
    expect(ant5g?.aliases.length).toBeGreaterThanOrEqual(1);

    // Verify stock movement was logged for initial stock
    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: orgId },
    });
    expect(movements.length).toBe(12);

    // 2. Second run: Upsert with updated prices and stock
    const updateCsv = `sku,name,description,unit,price,taxRate,stock,reorderLevel,aliases
ANT-5G-EXT-400,5G Directional Antenna Updated,New description,PCS,13000.00,18%,50,10,updated alias`;

    const req2 = new Request("http://localhost/api/products/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent: updateCsv, dryRun: false }),
    });

    const res2 = await importProducts(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();

    expect(data2.created).toBe(0);
    expect(data2.updated).toBe(1);

    // Verify updated product in DB
    const updatedAnt = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: orgId, sku: "ANT-5G-EXT-400" } },
      include: { inventoryLevel: true, aliases: true },
    });

    expect(updatedAnt?.name).toBe("5G Directional Antenna Updated");
    expect(updatedAnt?.inventoryLevel?.onHand).toBe(50);
    expect(updatedAnt?.aliases.some((a) => a.alias === "updated alias")).toBe(true);
  });
});
