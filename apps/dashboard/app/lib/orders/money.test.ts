import { describe, expect, it } from "vitest";
import {
  rupeesToPaise,
  paiseToRupeesString,
  formatMoney,
  calculateLineTotalPaise,
  calculateOrderTotals,
} from "./money";
import { Prisma } from "@rf-intelligence/db";

describe("Rule 4: Integer Minor Units (Paise) Calculations", () => {
  describe("rupeesToPaise", () => {
    it("converts number rupees to integer paise without float errors", () => {
      expect(rupeesToPaise(100)).toBe(10000);
      expect(rupeesToPaise(19.99)).toBe(1999);
      expect(rupeesToPaise(0.05)).toBe(5);
      expect(rupeesToPaise(0)).toBe(0);
    });

    it("converts string rupees to integer paise", () => {
      expect(rupeesToPaise("499.50")).toBe(49950);
      expect(rupeesToPaise("1200")).toBe(120000);
    });

    it("converts Prisma.Decimal to integer paise", () => {
      const decimal = new Prisma.Decimal("123.45");
      expect(rupeesToPaise(decimal)).toBe(12345);
    });

    it("throws on invalid or non-finite inputs", () => {
      expect(() => rupeesToPaise("invalid")).toThrow(TypeError);
      expect(() => rupeesToPaise(Number.NaN)).toThrow(TypeError);
      expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    });
  });

  describe("paiseToRupeesString", () => {
    it("formats integer paise into two decimal string", () => {
      expect(paiseToRupeesString(10000)).toBe("100.00");
      expect(paiseToRupeesString(1999)).toBe("19.99");
      expect(paiseToRupeesString(5)).toBe("0.05");
      expect(paiseToRupeesString(0)).toBe("0.00");
      expect(paiseToRupeesString(-250)).toBe("-2.50");
    });

    it("throws if non-integer is passed", () => {
      expect(() => paiseToRupeesString(12.34)).toThrow(TypeError);
    });
  });

  describe("formatMoney", () => {
    it("formats paise as INR currency", () => {
      const formatted = formatMoney(125050, "INR");
      // Intl format: contains 1,250.50
      expect(formatted).toContain("1,250.50");
    });
  });

  describe("calculateLineTotalPaise", () => {
    it("multiplies quantity and unitPricePaise with integer validation", () => {
      expect(calculateLineTotalPaise(5, 1000)).toBe(5000);
      expect(calculateLineTotalPaise(1, 0)).toBe(0);
    });

    it("throws if quantity is zero, negative, or not integer", () => {
      expect(() => calculateLineTotalPaise(0, 1000)).toThrow(TypeError);
      expect(() => calculateLineTotalPaise(-2, 1000)).toThrow(TypeError);
      expect(() => calculateLineTotalPaise(2.5, 1000)).toThrow(TypeError);
    });

    it("throws if unit price is negative or not integer", () => {
      expect(() => calculateLineTotalPaise(2, -100)).toThrow(TypeError);
      expect(() => calculateLineTotalPaise(2, 99.5)).toThrow(TypeError);
    });
  });

  describe("calculateOrderTotals", () => {
    it("calculates subtotal, 18% GST (1800 bps) and total in integer paise", () => {
      const items = [
        { quantity: 2, unitPricePaise: 10000 }, // 20,000 paise (₹200.00)
        { quantity: 3, unitPricePaise: 5000 },  // 15,000 paise (₹150.00)
      ];

      const totals = calculateOrderTotals(items, 1800);
      expect(totals.subtotalPaise).toBe(35000);
      // 35,000 * 0.18 = 6,300 paise
      expect(totals.taxPaise).toBe(6300);
      expect(totals.totalPaise).toBe(41300);
      expect(Number.isInteger(totals.totalPaise)).toBe(true);
    });

    it("handles zero items", () => {
      const totals = calculateOrderTotals([]);
      expect(totals.subtotalPaise).toBe(0);
      expect(totals.taxPaise).toBe(0);
      expect(totals.totalPaise).toBe(0);
    });

    it("handles odd numbers with precise integer rounding on tax", () => {
      // 1 item of 99 paise
      const totals = calculateOrderTotals([{ quantity: 1, unitPricePaise: 99 }], 1800);
      expect(totals.subtotalPaise).toBe(99);
      // 99 * 1800 / 10000 = 17.82 -> rounds to 18 paise
      expect(totals.taxPaise).toBe(18);
      expect(totals.totalPaise).toBe(117);
    });
  });
});
