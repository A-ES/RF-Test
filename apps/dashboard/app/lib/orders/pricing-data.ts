import { prisma } from "@/app/lib/db";
import type { CustomerPrice, DiscountRule, Prisma } from "@rf-intelligence/db";

export interface LoadPricingDataParams {
  organizationId: string;
  customerId?: string | null;
  productIds: string[];
}

export interface PricingDataResult {
  customerPrices: CustomerPrice[];
  discountRules: DiscountRule[];
}

/**
 * Loads only the needed CustomerPrice and DiscountRule records for a customer and set of product IDs.
 * Executes in exactly two database queries:
 * 1. Targeted CustomerPrice lookup for (organizationId, customerId, productIds).
 * 2. Targeted DiscountRule lookup for ORDER scope, matching CUSTOMER scope, and matching PRODUCT scope.
 */
export async function loadPricingData(
  params: LoadPricingDataParams,
): Promise<PricingDataResult> {
  const { organizationId, customerId, productIds } = params;

  // Query 1: Customer-specific contracted prices
  const customerPricesPromise =
    customerId && productIds.length > 0 && typeof prisma.customerPrice?.findMany === "function"
      ? prisma.customerPrice.findMany({
          where: {
            organizationId,
            customerId,
            productId: { in: productIds },
          },
        })
      : Promise.resolve([] as CustomerPrice[]);

  // Query 2: Discount rules (ORDER scope, matching CUSTOMER, and matching PRODUCT)
  const orFilters: Prisma.DiscountRuleWhereInput[] = [
    { scope: "ORDER" },
  ];

  if (customerId) {
    orFilters.push({ scope: "CUSTOMER", customerId });
  }

  if (productIds.length > 0) {
    orFilters.push({ scope: "PRODUCT", productId: { in: productIds } });
  }

  const discountRulesPromise =
    typeof prisma.discountRule?.findMany === "function"
      ? prisma.discountRule.findMany({
          where: {
            organizationId,
            OR: orFilters,
          },
          orderBy: { priority: "desc" },
        })
      : Promise.resolve([] as DiscountRule[]);

  const [customerPrices, discountRules] = await Promise.all([
    customerPricesPromise,
    discountRulesPromise,
  ]);

  return {
    customerPrices,
    discountRules,
  };
}
