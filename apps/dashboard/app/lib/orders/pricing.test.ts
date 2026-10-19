import { describe, expect, it } from "vitest";
import {
  priceOrder,
  roundHalfUp,
  type PriceOrderParams,
} from "./pricing";

describe("priceOrder Pure Function", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Base Price Only & Basic Calculations
  // ───────────────────────────────────────────────────────────────────────────

  it("calculates basic line total and 18% tax from base price without discounts", () => {
    const res = priceOrder({
      lines: [
        {
          productId: "prod_1",
          sku: "ANT-5G",
          quantity: 2,
          basePriceMinor: 100000, // ₹1,000.00
          taxRateBps: 1800, // 18% GST
        },
      ],
    });

    expect(res.subtotalMinor).toBe(200000); // ₹2,000.00
    expect(res.discountMinor).toBe(0);
    expect(res.taxMinor).toBe(36000); // 18% of ₹2,000.00 = ₹360.00
    expect(res.totalMinor).toBe(236000); // ₹2,360.00
    expect(res.flags).toEqual([]);
    expect(res.lines[0].unitPriceMinor).toBe(100000);
    expect(res.lines[0].netTotalMinor).toBe(200000);
    expect(res.lines[0].taxMinor).toBe(36000);
    expect(res.lines[0].totalMinor).toBe(236000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Precedence: Customer Price vs Base Price
  // ───────────────────────────────────────────────────────────────────────────

  it("prioritizes customer-specific price over catalog base price", () => {
    const res = priceOrder({
      lines: [
        {
          productId: "prod_1",
          quantity: 5,
          basePriceMinor: 50000, // ₹500
          taxRateBps: 1800,
        },
      ],
      customer: { id: "cust_vip" },
      rules: {
        customerPrices: [
          {
            customerId: "cust_vip",
            productId: "prod_1",
            priceMinor: 40000, // Negotiated ₹400
          },
        ],
      },
    });

    expect(res.lines[0].unitPriceMinor).toBe(40000);
    expect(res.subtotalMinor).toBe(200000); // 5 * 40,000 = 200,000
    expect(res.taxMinor).toBe(36000);
    expect(res.totalMinor).toBe(236000);
  });

  it("customer price beating discount: contract price lower than base price with discount", () => {
    // Base price = ₹1,000. Discount = 10% (would make it ₹900).
    // Customer contract price = ₹800. Customer price takes precedence.
    const res = priceOrder({
      lines: [
        {
          productId: "prod_antenna",
          quantity: 1,
          basePriceMinor: 100000, // ₹1,000
          taxRateBps: 0,
        },
      ],
      customer: { id: "cust_enterprise" },
      rules: {
        customerPrices: [
          {
            customerId: "cust_enterprise",
            productId: "prod_antenna",
            priceMinor: 80000, // ₹800 contracted
          },
        ],
      },
    });

    expect(res.lines[0].unitPriceMinor).toBe(80000);
    expect(res.totalMinor).toBe(80000);
    expect(res.totalMinor).toBeLessThan(90000); // beats ₹900
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Precedence: Manual Override & PRICE_OVERRIDDEN Flag
  // ───────────────────────────────────────────────────────────────────────────

  it("manual price override beats customer price and base price, emitting PRICE_OVERRIDDEN", () => {
    const res = priceOrder({
      lines: [
        {
          productId: "prod_1",
          quantity: 2,
          basePriceMinor: 50000,
          unitPriceOverrideMinor: 35000, // override
          taxRateBps: 1800,
        },
      ],
      customer: { id: "cust_vip" },
      rules: {
        customerPrices: [
          {
            customerId: "cust_vip",
            productId: "prod_1",
            priceMinor: 45000,
          },
        ],
      },
    });

    expect(res.lines[0].unitPriceMinor).toBe(35000);
    expect(res.subtotalMinor).toBe(70000);
    expect(res.flags).toContain("PRICE_OVERRIDDEN");
    expect(res.lines[0].flags).toContain("PRICE_OVERRIDDEN");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. NO_PRICE Flag
  // ───────────────────────────────────────────────────────────────────────────

  it("emits NO_PRICE flag when a line has no base price, customer price, or override", () => {
    const res = priceOrder({
      lines: [
        {
          productId: "prod_unpriced",
          quantity: 3,
        },
      ],
    });

    expect(res.lines[0].unitPriceMinor).toBe(0);
    expect(res.subtotalMinor).toBe(0);
    expect(res.flags).toContain("NO_PRICE");
    expect(res.lines[0].flags).toContain("NO_PRICE");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Expiry Boundaries: CustomerPrice (now vs validFrom / validTo)
  // ───────────────────────────────────────────────────────────────────────────

  const fixedNow = new Date("2026-06-15T12:00:00Z");

  it("CustomerPrice expiry boundary: falls back to base price when expired (now > validTo)", () => {
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 50000 }],
      customer: { id: "c1" },
      rules: {
        customerPrices: [
          {
            customerId: "c1",
            productId: "p1",
            priceMinor: 30000,
            validTo: new Date("2026-06-01T00:00:00Z"), // Expired 2 weeks ago
          },
        ],
      },
      now: fixedNow,
    });

    expect(res.lines[0].unitPriceMinor).toBe(50000); // fell back to base
    expect(res.flags).toContain("EXPIRED_RULE_IGNORED");
  });

  it("CustomerPrice future boundary: falls back to base price when not yet active (now < validFrom)", () => {
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 50000 }],
      customer: { id: "c1" },
      rules: {
        customerPrices: [
          {
            customerId: "c1",
            productId: "p1",
            priceMinor: 30000,
            validFrom: new Date("2026-07-01T00:00:00Z"), // Starts next month
          },
        ],
      },
      now: fixedNow,
    });

    expect(res.lines[0].unitPriceMinor).toBe(50000);
    expect(res.flags).toContain("EXPIRED_RULE_IGNORED");
  });

  it("CustomerPrice boundary: applies when now is exactly validFrom", () => {
    const exactDate = new Date("2026-06-15T12:00:00Z");
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 50000 }],
      customer: { id: "c1" },
      rules: {
        customerPrices: [
          {
            customerId: "c1",
            productId: "p1",
            priceMinor: 35000,
            validFrom: exactDate,
          },
        ],
      },
      now: exactDate,
    });

    expect(res.lines[0].unitPriceMinor).toBe(35000);
    expect(res.flags).not.toContain("EXPIRED_RULE_IGNORED");
  });

  it("CustomerPrice boundary: applies when now is exactly validTo", () => {
    const exactDate = new Date("2026-06-15T12:00:00Z");
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 50000 }],
      customer: { id: "c1" },
      rules: {
        customerPrices: [
          {
            customerId: "c1",
            productId: "p1",
            priceMinor: 35000,
            validTo: exactDate,
          },
        ],
      },
      now: exactDate,
    });

    expect(res.lines[0].unitPriceMinor).toBe(35000);
    expect(res.flags).not.toContain("EXPIRED_RULE_IGNORED");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Expiry Boundaries: DiscountRule (now vs validFrom / validTo)
  // ───────────────────────────────────────────────────────────────────────────

  it("DiscountRule boundary: ignores discount when now > validTo, emitting EXPIRED_RULE_IGNORED", () => {
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 10000, taxRateBps: 0 }],
      rules: [
        {
          scope: "PRODUCT",
          productId: "p1",
          type: "PERCENT",
          value: 10,
          validTo: new Date("2026-06-01T00:00:00Z"), // Expired
        },
      ],
      now: fixedNow,
    });

    expect(res.discountMinor).toBe(0);
    expect(res.totalMinor).toBe(10000);
    expect(res.flags).toContain("EXPIRED_RULE_IGNORED");
  });

  it("DiscountRule boundary: ignores discount when now < validFrom, emitting EXPIRED_RULE_IGNORED", () => {
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 10000, taxRateBps: 0 }],
      rules: [
        {
          scope: "PRODUCT",
          productId: "p1",
          type: "PERCENT",
          value: 10,
          validFrom: new Date("2026-07-01T00:00:00Z"), // Future
        },
      ],
      now: fixedNow,
    });

    expect(res.discountMinor).toBe(0);
    expect(res.totalMinor).toBe(10000);
    expect(res.flags).toContain("EXPIRED_RULE_IGNORED");
  });

  it("DiscountRule boundary: applies discount when now is exactly validFrom", () => {
    const exactDate = new Date("2026-06-15T12:00:00Z");
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 10000, taxRateBps: 0 }],
      rules: [
        {
          scope: "PRODUCT",
          productId: "p1",
          type: "PERCENT",
          value: 10,
          validFrom: exactDate,
        },
      ],
      now: exactDate,
    });

    expect(res.discountMinor).toBe(1000);
    expect(res.totalMinor).toBe(9000);
    expect(res.flags).not.toContain("EXPIRED_RULE_IGNORED");
  });

  it("DiscountRule boundary: applies discount when now is exactly validTo", () => {
    const exactDate = new Date("2026-06-15T12:00:00Z");
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 10000, taxRateBps: 0 }],
      rules: [
        {
          scope: "PRODUCT",
          productId: "p1",
          type: "PERCENT",
          value: 10,
          validTo: exactDate,
        },
      ],
      now: exactDate,
    });

    expect(res.discountMinor).toBe(1000);
    expect(res.totalMinor).toBe(9000);
    expect(res.flags).not.toContain("EXPIRED_RULE_IGNORED");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. MinQty Edge Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe("MinQty Edge Behavior", () => {
    const testCases = [
      { qty: 9, minQty: 10, expectDiscount: 0, desc: "qty 9 is below minQty 10" },
      { qty: 10, minQty: 10, expectDiscount: 10000, desc: "qty 10 exactly meets minQty 10" },
      { qty: 11, minQty: 10, expectDiscount: 11000, desc: "qty 11 exceeds minQty 10" },
      { qty: 1, minQty: 1, expectDiscount: 1000, desc: "qty 1 exactly meets minQty 1" },
    ];

    for (const tc of testCases) {
      it(`minQty test: ${tc.desc}`, () => {
        const res = priceOrder({
          lines: [{ productId: "p1", quantity: tc.qty, basePriceMinor: 10000, taxRateBps: 0 }],
          rules: [
            {
              scope: "PRODUCT",
              productId: "p1",
              type: "PERCENT",
              value: 10,
              minQty: tc.minQty,
            },
          ],
        });

        expect(res.discountMinor).toBe(tc.expectDiscount);
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. MinOrderMinor Edge Tests
  // ───────────────────────────────────────────────────────────────────────────

  describe("MinOrderMinor Edge Behavior", () => {
    it("minOrderMinor = 100000 (₹1,000): subtotal ₹999.99 does NOT trigger order discount", () => {
      const res = priceOrder({
        lines: [{ productId: "p1", quantity: 1, basePriceMinor: 99999, taxRateBps: 0 }],
        rules: [
          {
            scope: "ORDER",
            type: "PERCENT",
            value: 10,
            minOrderMinor: 100000,
          },
        ],
      });
      expect(res.discountMinor).toBe(0);
    });

    it("minOrderMinor = 100000 (₹1,000): subtotal exactly ₹1,000.00 DOES trigger order discount", () => {
      const res = priceOrder({
        lines: [{ productId: "p1", quantity: 1, basePriceMinor: 100000, taxRateBps: 0 }],
        rules: [
          {
            scope: "ORDER",
            type: "PERCENT",
            value: 10,
            minOrderMinor: 100000,
          },
        ],
      });
      expect(res.discountMinor).toBe(10000);
      expect(res.totalMinor).toBe(90000);
    });

    it("minOrderMinor = 100000 (₹1,000): subtotal ₹1,000.01 triggers order discount", () => {
      const res = priceOrder({
        lines: [{ productId: "p1", quantity: 1, basePriceMinor: 100001, taxRateBps: 0 }],
        rules: [
          {
            scope: "ORDER",
            type: "PERCENT",
            value: 10,
            minOrderMinor: 100000,
          },
        ],
      });
      // 10% of 100001 = 10000.1 -> rounds half-up to 10000
      expect(res.discountMinor).toBe(10000);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Rounding: 0.5 Paise Cases (Mathematical Round Half-Up)
  // ───────────────────────────────────────────────────────────────────────────

  describe("Rounding Half-Up on 0.5 Paise Cases", () => {
    it("roundHalfUp pure helper unit assertions", () => {
      // 0.5 -> 1
      expect(roundHalfUp(5, 10)).toBe(1);
      expect(roundHalfUp(1, 2)).toBe(1);
      // 0.4999 -> 0
      expect(roundHalfUp(4999, 10000)).toBe(0);
      // 1.5 -> 2
      expect(roundHalfUp(15, 10)).toBe(2);
      expect(roundHalfUp(3, 2)).toBe(2);
      // 2.5 -> 3
      expect(roundHalfUp(25, 10)).toBe(3);
      expect(roundHalfUp(5, 2)).toBe(3);
      // 2.49 -> 2
      expect(roundHalfUp(249, 100)).toBe(2);
      // 3.5 -> 4
      expect(roundHalfUp(35, 10)).toBe(4);
    });

    it("line tax rounding: post-discount 25 paise at 10% tax (1000 bps) = 2.5 paise -> rounds to 3 paise", () => {
      const res = priceOrder({
        lines: [{ productId: "p1", quantity: 1, basePriceMinor: 25, taxRateBps: 1000 }],
      });
      expect(res.taxMinor).toBe(3);
      expect(res.totalMinor).toBe(28);
    });

    it("line tax rounding: post-discount 15 paise at 10% tax = 1.5 paise -> rounds to 2 paise", () => {
      const res = priceOrder({
        lines: [{ productId: "p1", quantity: 1, basePriceMinor: 15, taxRateBps: 1000 }],
      });
      expect(res.taxMinor).toBe(2);
      expect(res.totalMinor).toBe(17);
    });

    it("line tax rounding: post-discount 5 paise at 10% tax = 0.5 paise -> rounds to 1 paise", () => {
      const res = priceOrder({
        lines: [{ productId: "p1", quantity: 1, basePriceMinor: 5, taxRateBps: 1000 }],
      });
      expect(res.taxMinor).toBe(1);
      expect(res.totalMinor).toBe(6);
    });

    it("line tax rounding: post-discount 4 paise at 10% tax = 0.4 paise -> rounds down to 0 paise", () => {
      const res = priceOrder({
        lines: [{ productId: "p1", quantity: 1, basePriceMinor: 4, taxRateBps: 1000 }],
      });
      expect(res.taxMinor).toBe(0);
      expect(res.totalMinor).toBe(4);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Zero Tax
  // ───────────────────────────────────────────────────────────────────────────

  it("zero tax: computes zero tax when taxRateBps is 0", () => {
    const res = priceOrder({
      lines: [
        { productId: "p1", quantity: 4, basePriceMinor: 25000, taxRateBps: 0 },
        { productId: "p2", quantity: 2, basePriceMinor: 15000, taxRateBps: 0 },
      ],
    });

    expect(res.subtotalMinor).toBe(130000);
    expect(res.taxMinor).toBe(0);
    expect(res.totalMinor).toBe(130000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. Stacking: Line-Level + Order-Level Discounts
  // ───────────────────────────────────────────────────────────────────────────

  it("discount stacking: line-level product rule (10%) then order-level rule (5%) on discounted subtotal", () => {
    // 1 unit @ ₹1,000 (100,000 paise).
    // Line discount: 10% of 100,000 = 10,000 paise -> remaining = 90,000 paise.
    // Order discount: 5% of 90,000 = 4,500 paise -> remaining = 85,500 paise.
    // Total discount = 14,500 paise.
    // Tax 18% on 85,500 = 15,390 paise.
    // Total = 85,500 + 15,390 = 100,890 paise.
    const res = priceOrder({
      lines: [
        {
          productId: "p1",
          quantity: 1,
          basePriceMinor: 100000,
          taxRateBps: 1800,
        },
      ],
      rules: [
        {
          id: "rule_prod",
          scope: "PRODUCT",
          productId: "p1",
          type: "PERCENT",
          value: 10, // 10%
          priority: 2,
        },
        {
          id: "rule_order",
          scope: "ORDER",
          type: "PERCENT",
          value: 5, // 5%
          priority: 1,
        },
      ],
    });

    expect(res.subtotalMinor).toBe(100000);
    expect(res.discountMinor).toBe(14500);
    expect(res.lines[0].discountMinor).toBe(14500);
    expect(res.lines[0].netTotalMinor).toBe(85500);
    expect(res.taxMinor).toBe(15390);
    expect(res.totalMinor).toBe(100890);
  });

  it("discount stacking: multiple line rules respect priority order", () => {
    // Priority 10: 10% off 100,000 -> 10,000 discount -> 90,000 left.
    // Priority 5: ₹200 (20,000 minor) fixed off -> 20,000 discount -> 70,000 left.
    // Total line discount = 30,000.
    const res = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 100000, taxRateBps: 0 }],
      rules: [
        {
          scope: "PRODUCT",
          productId: "p1",
          type: "FIXED",
          value: 20000,
          priority: 5,
        },
        {
          scope: "PRODUCT",
          productId: "p1",
          type: "PERCENT",
          value: 10,
          priority: 10, // higher priority runs first
        },
      ],
    });

    expect(res.discountMinor).toBe(30000);
    expect(res.totalMinor).toBe(70000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 12. Recalculation Consistency after Qty Edits
  // ───────────────────────────────────────────────────────────────────────────

  it("recalculation after qty edits gives identical results to a fresh price", () => {
    const baseParams: Omit<PriceOrderParams, "lines"> = {
      customer: { id: "cust_1" },
      rules: [
        {
          scope: "PRODUCT",
          productId: "p1",
          type: "PERCENT",
          value: 10,
          minQty: 5,
        },
        {
          scope: "ORDER",
          type: "PERCENT",
          value: 5,
          minOrderMinor: 20000,
        },
      ],
      taxConfig: { defaultTaxRateBps: 1800 },
      now: fixedNow,
    };

    // Step 1: Initial order with qty = 2
    const orderV1 = priceOrder({
      ...baseParams,
      lines: [{ productId: "p1", quantity: 2, basePriceMinor: 10000 }],
    });
    // With qty 2, minQty 5 is not met; minOrderMinor 20000 is met (2 * 10000 = 20000).
    expect(orderV1.lines[0].quantity).toBe(2);

    // Step 2: Edit qty to 10
    const editedOrder = priceOrder({
      ...baseParams,
      lines: [{ productId: "p1", quantity: 10, basePriceMinor: 10000 }],
    });

    // Step 3: Fresh standalone order created from scratch with qty = 10
    const freshOrder = priceOrder({
      ...baseParams,
      lines: [{ productId: "p1", quantity: 10, basePriceMinor: 10000 }],
    });

    // Both must be strictly identical in all output fields
    expect(editedOrder.subtotalMinor).toBe(freshOrder.subtotalMinor);
    expect(editedOrder.discountMinor).toBe(freshOrder.discountMinor);
    expect(editedOrder.taxMinor).toBe(freshOrder.taxMinor);
    expect(editedOrder.totalMinor).toBe(freshOrder.totalMinor);
    expect(editedOrder.flags).toEqual(freshOrder.flags);
    expect(editedOrder.lines).toEqual(freshOrder.lines);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 13. Flags: QTY_NOT_INTEGER and NEGATIVE_TOTAL
  // ───────────────────────────────────────────────────────────────────────────

  it("flags QTY_NOT_INTEGER when line quantity is fractional", () => {
    const res = priceOrder({
      lines: [
        {
          productId: "p1",
          quantity: 2.5, // non-integer quantity
          basePriceMinor: 10000,
          taxRateBps: 0,
        },
      ],
    });

    expect(res.flags).toContain("QTY_NOT_INTEGER");
    expect(res.lines[0].flags).toContain("QTY_NOT_INTEGER");
  });

  it("flags NEGATIVE_TOTAL when fixed discount exceeds line subtotal", () => {
    const res = priceOrder({
      lines: [
        {
          productId: "p1",
          quantity: 1,
          basePriceMinor: 5000, // ₹50
          taxRateBps: 0,
        },
      ],
      rules: [
        {
          scope: "PRODUCT",
          productId: "p1",
          type: "FIXED",
          value: 10000, // ₹100 discount (exceeds price)
        },
      ],
    });

    expect(res.totalMinor).toBeLessThan(0);
    expect(res.flags).toContain("NEGATIVE_TOTAL");
    expect(res.lines[0].flags).toContain("NEGATIVE_TOTAL");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 14. Multi-Line Order with Mixed Tax Rates & Exact Sum Totals
  // ───────────────────────────────────────────────────────────────────────────

  it("multi-line order allocates order-level discount and sums rounded line totals perfectly", () => {
    // Line 1: 5 units @ ₹1,000 (18% GST) = 500,000 subtotal
    // Line 2: 2 units @ ₹500 (5% GST)   = 100,000 subtotal
    // Line 3: 1 unit  @ ₹200 (0% GST)   =  20,000 subtotal
    // Total subtotal = 620,000 paise.
    // Order discount: 10% flat = 62,000 paise.
    const res = priceOrder({
      lines: [
        { productId: "p1", quantity: 5, basePriceMinor: 100000, taxRateBps: 1800 },
        { productId: "p2", quantity: 2, basePriceMinor: 50000, taxRateBps: 500 },
        { productId: "p3", quantity: 1, basePriceMinor: 20000, taxRateBps: 0 },
      ],
      rules: [
        {
          scope: "ORDER",
          type: "PERCENT",
          value: 10,
        },
      ],
    });

    expect(res.subtotalMinor).toBe(620000);
    expect(res.discountMinor).toBe(62000);

    // Sum of line discounts must equal order discount exactly
    const sumLineDiscounts = res.lines.reduce((s, l) => s + l.discountMinor, 0);
    expect(sumLineDiscounts).toBe(62000);

    // Totals must be exact sums of rounded lines
    const sumLineTotals = res.lines.reduce((s, l) => s + l.totalMinor, 0);
    const sumLineTaxes = res.lines.reduce((s, l) => s + l.taxMinor, 0);
    expect(res.totalMinor).toBe(sumLineTotals);
    expect(res.taxMinor).toBe(sumLineTaxes);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 15. Customer Scope Discounts (CUSTOMER scope)
  // ───────────────────────────────────────────────────────────────────────────

  it("applies CUSTOMER scope discount only to matching customer", () => {
    const rules = [
      {
        scope: "CUSTOMER" as const,
        customerId: "cust_acme",
        type: "PERCENT" as const,
        value: 15,
      },
    ];

    // Non-matching customer
    const resOther = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 10000, taxRateBps: 0 }],
      customer: { id: "cust_other" },
      rules,
    });
    expect(resOther.discountMinor).toBe(0);

    // Matching customer
    const resAcme = priceOrder({
      lines: [{ productId: "p1", quantity: 1, basePriceMinor: 10000, taxRateBps: 0 }],
      customer: { id: "cust_acme" },
      rules,
    });
    expect(resAcme.discountMinor).toBe(1500);
    expect(resAcme.totalMinor).toBe(8500);
  });
});
