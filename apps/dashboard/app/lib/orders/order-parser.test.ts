import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const findManyInventory = vi.fn();
  const findManyProduct = vi.fn();
  return {
    findManyInventory,
    findManyProduct,
    prisma: {
      product: {
        findMany: findManyProduct,
      },
      inventoryItem: {
        findMany: findManyInventory,
      },
    },
  };
});

vi.mock("@/app/lib/db", () => ({
  prisma: h.prisma,
}));

import {
  extractItemRequests,
  parseOrderFromMessage,
} from "./order-parser";

describe("Order Parser: extractItemRequests", () => {
  it("extracts '10x SKU' syntax correctly", () => {
    const text = "Hi, we need 10x ANT-PATCH-5G immediately.";
    const requests = extractItemRequests(text);
    expect(requests).toEqual([{ rawQuery: "ANT-PATCH-5G", quantity: 10 }]);
  });

  it("extracts 'need 5 units of SKU' syntax correctly", () => {
    const text = "Please order 5 units of MNT-MAST-CLAMP for installation";
    const requests = extractItemRequests(text);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.quantity).toBe(5);
    expect(requests[0]?.rawQuery).toBe("MNT-MAST-CLAMP");
  });

  it("extracts 'SKU: 15' syntax correctly", () => {
    const text = "Order items: CAB-LMR400-10M: 15";
    const requests = extractItemRequests(text);
    expect(requests).toEqual([{ rawQuery: "CAB-LMR400-10M", quantity: 15 }]);
  });

  it("returns empty array when no quantities or products are mentioned", () => {
    const text = "Hello, what time does your warehouse close today?";
    const requests = extractItemRequests(text);
    expect(requests).toEqual([]);
  });
});

describe("Order Parser: parseOrderFromMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("identifies inventory match, computes paise pricing, and detects sufficient stock", async () => {
    h.findManyProduct.mockResolvedValue([
      {
        id: "prod_1",
        sku: "ANT-5G-EXT",
        name: "5G External Antenna",
        basePriceMinor: 250000, // ₹2,500 = 250,000 paise
        aliases: [],
        inventoryLevel: { onHand: 20, reserved: 2 }, // 18 available
      },
    ]);

    const result = await parseOrderFromMessage(
      "org_123",
      "We want to order 5x ANT-5G-EXT please",
    );

    expect(result.hasOrderIntent).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.sku).toBe("ANT-5G-EXT");
    expect(result.items[0]?.quantity).toBe(5);
    expect(result.items[0]?.unitPricePaise).toBe(250000);
    expect(result.items[0]?.totalPricePaise).toBe(1250000);
    expect(result.items[0]?.hasSufficientStock).toBe(true);
    expect(result.allStockAvailable).toBe(true);

    // subtotal = 1,250,000 paise, 18% tax = 225,000 paise, total = 1,475,000 paise
    expect(result.subtotalPaise).toBe(1250000);
    expect(result.taxPaise).toBe(225000);
    expect(result.totalPaise).toBe(1475000);
  });

  it("flags insufficient stock when requested quantity exceeds available stock", async () => {
    h.findManyProduct.mockResolvedValue([
      {
        id: "prod_2",
        sku: "CAB-SMA-10M",
        name: "SMA 10m Cable",
        basePriceMinor: 35000, // ₹350 = 35,000 paise
        aliases: [],
        inventoryLevel: { onHand: 3, reserved: 1 }, // 2 available
      },
    ]);

    const result = await parseOrderFromMessage(
      "org_123",
      "Need 10x CAB-SMA-10M for site",
    );

    expect(result.hasOrderIntent).toBe(true);
    expect(result.items[0]?.quantity).toBe(10);
    expect(result.items[0]?.availableStock).toBe(2);
    expect(result.items[0]?.hasSufficientStock).toBe(false);
    expect(result.allStockAvailable).toBe(false);
    expect(result.requiresClarification).toBe(true);
  });

  it("handles general order keywords without matching SKUs by requesting clarification", async () => {
    h.findManyProduct.mockResolvedValue([]);
    h.findManyInventory.mockResolvedValue([]);

    const result = await parseOrderFromMessage(
      "org_123",
      "I want to place an order for parts",
    );

    expect(result.hasOrderIntent).toBe(true);
    expect(result.requiresClarification).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.clarificationMessage).toContain("specify the product SKU");
  });
});
