import { describe, expect, it } from "vitest";
import { nextNumber, formatSequenceNumber } from "@rf-intelligence/db";
import { prisma } from "@/app/lib/db";

describe("OrgCounter: Race-Free Sequential Numbering", () => {
  it("formats sequence numbers with prefix and zero-padding", () => {
    expect(formatSequenceNumber(1, "ORD-2026-", 4)).toBe("ORD-2026-0001");
    expect(formatSequenceNumber(42, "INV-", 5)).toBe("INV-00042");
    expect(formatSequenceNumber(1005, "DFT-", 4)).toBe("DFT-1005");
  });

  it("CRITICAL: proves two concurrent next-number calls NEVER return the same number", async () => {
    const testOrgId = `org_test_concurrent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Ensure clean state for this unique test organization
    await prisma.organization.create({
      data: {
        id: testOrgId,
        name: "Concurrency Test Org",
      },
    });

    try {
      // Fire 2 concurrent nextNumber calls simultaneously
      const [num1, num2] = await Promise.all([
        nextNumber(testOrgId, "ORDER", prisma),
        nextNumber(testOrgId, "ORDER", prisma),
      ]);

      // Assert that neither call received the same number
      expect(num1).not.toBe(num2);
      expect([num1, num2].sort((a, b) => a - b)).toEqual([1, 2]);

      // Fire a burst of 10 more concurrent requests simultaneously
      const burstPromises = Array.from({ length: 10 }, () =>
        nextNumber(testOrgId, "ORDER", prisma),
      );
      const burstResults = await Promise.all(burstPromises);

      // Verify every single number in the burst is completely unique
      const uniqueBurstNumbers = new Set(burstResults);
      expect(uniqueBurstNumbers.size).toBe(10);

      // Verify the total sequence contains all numbers from 3 to 12
      const allNumbers = [num1, num2, ...burstResults].sort((a, b) => a - b);
      expect(allNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    } finally {
      // Clean up test org
      await prisma.organization.deleteMany({
        where: { id: testOrgId },
      });
    }
  });

  it("maintains isolated sequences for different counter keys (ORDER vs INVOICE vs DRAFT)", async () => {
    const testOrgId = `org_test_keys_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    await prisma.organization.create({
      data: {
        id: testOrgId,
        name: "Counter Keys Test Org",
      },
    });

    try {
      const orderNum = await nextNumber(testOrgId, "ORDER", prisma);
      const invoiceNum = await nextNumber(testOrgId, "INVOICE", prisma);
      const draftNum = await nextNumber(testOrgId, "DRAFT", prisma);

      // All separate keys should independently initialize at 1
      expect(orderNum).toBe(1);
      expect(invoiceNum).toBe(1);
      expect(draftNum).toBe(1);

      // Incrementing order should not touch invoice
      const nextOrderNum = await nextNumber(testOrgId, "ORDER", prisma);
      expect(nextOrderNum).toBe(2);

      const nextInvoiceNum = await nextNumber(testOrgId, "INVOICE", prisma);
      expect(nextInvoiceNum).toBe(2);
    } finally {
      await prisma.organization.deleteMany({
        where: { id: testOrgId },
      });
    }
  });
});
