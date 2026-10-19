/**
 * Pure Pricing Engine for RF Intelligence Orders.
 *
 * Non-negotiable requirements:
 * 1. PURE function: No DB calls, no network I/O, no side-effects.
 * 2. Integer arithmetic in minor units (paise).
 * 3. Line pricing precedence:
 *    - Manual override (PRICE_OVERRIDDEN)
 *    - Customer-specific price (CustomerPrice)
 *    - Base price (Product.basePriceMinor)
 *    - If no price found -> NO_PRICE flag
 * 4. Discounts applied by priority:
 *    - Line-level (PRODUCT, CUSTOMER) rules first
 *    - Order-level (ORDER) rules second on the discounted subtotal
 *    - Respects validFrom/validTo, minQty, and minOrderMinor
 * 5. Tax computed per line on post-discount amount using product taxRateBps,
 *    rounded half-up per line.
 * 6. Totals are sums of rounded lines.
 * 7. Emits flags: NO_PRICE, EXPIRED_RULE_IGNORED, NEGATIVE_TOTAL, QTY_NOT_INTEGER, PRICE_OVERRIDDEN.
 */

export type PricingFlag =
  | "NO_PRICE"
  | "EXPIRED_RULE_IGNORED"
  | "NEGATIVE_TOTAL"
  | "QTY_NOT_INTEGER"
  | "PRICE_OVERRIDDEN";

export type DiscountScope = "CUSTOMER" | "PRODUCT" | "ORDER";
export type DiscountType = "PERCENT" | "FIXED";

export interface PricingOrderLineInput {
  id?: string;
  productId?: string;
  sku?: string;
  quantity?: number;
  qty?: number;
  basePriceMinor?: number | null;
  taxRateBps?: number | null;
  customerPriceMinor?: number | null;
  unitPriceOverrideMinor?: number | null;
  overridePriceMinor?: number | null;
}

export interface CustomerPriceInput {
  id?: string;
  customerId?: string | null;
  productId: string;
  priceMinor: number;
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
}

export interface DiscountRuleInput {
  id?: string;
  scope: DiscountScope;
  customerId?: string | null;
  productId?: string | null;
  type: DiscountType;
  value: number; // In basis points (e.g. 1000 for 10%) or percent (e.g. 10 for 10%), or minor paise for FIXED
  minQty?: number | null;
  minOrderMinor?: number | null;
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
  priority?: number;
  perUnit?: boolean; // For line-level FIXED discounts; defaults to true
}

export interface PricingRulesInput {
  customerPrices?: CustomerPriceInput[];
  discountRules?: DiscountRuleInput[];
}

export interface CustomerPricingInput {
  id?: string;
  name?: string;
  prices?: CustomerPriceInput[];
  customerPrices?: CustomerPriceInput[];
}

export interface TaxConfigInput {
  defaultTaxRateBps?: number;
}

export interface PriceOrderParams {
  lines: PricingOrderLineInput[];
  customer?: CustomerPricingInput | null;
  rules?: PricingRulesInput | DiscountRuleInput[];
  taxConfig?: TaxConfigInput;
  now?: Date | string | number;
}

export interface AppliedDiscountDetail {
  ruleId?: string;
  scope: DiscountScope;
  type: DiscountType;
  value: number;
  amountMinor: number;
}

export interface PricedOrderLine {
  id?: string;
  productId?: string;
  sku?: string;
  quantity: number;
  unitPriceMinor: number;
  baseTotalMinor: number;
  discountMinor: number;
  netTotalMinor: number;
  taxRateBps: number;
  taxMinor: number;
  totalMinor: number;
  flags: PricingFlag[];
  appliedDiscounts: AppliedDiscountDetail[];
}

export interface PricedOrder {
  lines: PricedOrderLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  flags: PricingFlag[];
}

/**
 * Exact mathematical rounding half-up:
 * x.5 rounds away from zero (towards positive infinity for positive values).
 * 0.5 -> 1, 1.5 -> 2, 2.5 -> 3, 2.4 -> 2, 0.4 -> 0
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (denominator === 0 || numerator === 0) return 0;
  if (numerator > 0) {
    return Math.floor((numerator * 2 + denominator) / (denominator * 2));
  }
  return Math.ceil((numerator * 2 - denominator) / (denominator * 2));
}

/**
 * Helper to check date validity against validFrom / validTo.
 */
function checkDateValidity(
  now: Date,
  validFrom?: Date | string | null,
  validTo?: Date | string | null,
): { valid: boolean; isExpiredOrFuture: boolean } {
  if (!validFrom && !validTo) {
    return { valid: true, isExpiredOrFuture: false };
  }
  const nowMs = now.getTime();
  const fromMs = validFrom ? new Date(validFrom).getTime() : null;
  const toMs = validTo ? new Date(validTo).getTime() : null;

  if (fromMs !== null && nowMs < fromMs) {
    return { valid: false, isExpiredOrFuture: true };
  }
  if (toMs !== null && nowMs > toMs) {
    return { valid: false, isExpiredOrFuture: true };
  }
  return { valid: true, isExpiredOrFuture: false };
}

/**
 * Normalizes percentage values:
 * If value <= 100, treated as percentage (e.g. 10 -> 10% = 1000 bps).
 * If value > 100, treated as basis points (e.g. 1000 -> 10% = 1000 bps).
 */
function getPercentFraction(value: number): { numerator: number; denominator: number } {
  if (value <= 100) {
    return { numerator: value, denominator: 100 };
  }
  return { numerator: value, denominator: 10000 };
}

/**
 * Pure calculation function for order pricing.
 */
export function priceOrder(params: PriceOrderParams): PricedOrder {
  const { lines, customer, taxConfig } = params;
  const now = params.now ? new Date(params.now) : new Date();

  // Extract customer prices and discount rules
  let customerPrices: CustomerPriceInput[] = [];
  let discountRules: DiscountRuleInput[] = [];

  if (Array.isArray(params.rules)) {
    discountRules = params.rules;
  } else if (params.rules) {
    if (params.rules.customerPrices) customerPrices = params.rules.customerPrices;
    if (params.rules.discountRules) discountRules = params.rules.discountRules;
  }

  // Also accept customer prices from customer object
  if (customer?.customerPrices) {
    customerPrices = [...customerPrices, ...customer.customerPrices];
  } else if (customer?.prices) {
    customerPrices = [...customerPrices, ...customer.prices];
  }

  const orderFlagsSet = new Set<PricingFlag>();

  // Intermediate state for lines
  interface IntermediateLine {
    input: PricingOrderLineInput;
    quantity: number;
    unitPriceMinor: number;
    baseTotalMinor: number;
    lineDiscountMinor: number;
    allocatedOrderDiscountMinor: number;
    appliedDiscounts: AppliedDiscountDetail[];
    flags: Set<PricingFlag>;
    taxRateBps: number;
  }

  const intermediateLines: IntermediateLine[] = [];
  let totalOrderQty = 0;

  for (const line of lines) {
    const rawQty = line.quantity ?? line.qty ?? 0;
    const lineFlags = new Set<PricingFlag>();

    if (!Number.isInteger(rawQty)) {
      lineFlags.add("QTY_NOT_INTEGER");
      orderFlagsSet.add("QTY_NOT_INTEGER");
    }

    const quantity = rawQty;
    totalOrderQty += quantity;

    // 1. Determine Unit Price Precedence:
    // Manual override > Customer Price > Base Price
    const manualOverride = line.unitPriceOverrideMinor ?? line.overridePriceMinor;
    let resolvedUnitPrice: number | null = null;

    if (manualOverride !== undefined && manualOverride !== null) {
      resolvedUnitPrice = manualOverride;
      lineFlags.add("PRICE_OVERRIDDEN");
      orderFlagsSet.add("PRICE_OVERRIDDEN");
    } else {
      // Check customer price
      let matchedCustomerPrice: CustomerPriceInput | null = null;
      if (line.productId) {
        for (const cp of customerPrices) {
          if (cp.productId === line.productId) {
            if (!cp.customerId || !customer?.id || cp.customerId === customer.id) {
              const dateCheck = checkDateValidity(now, cp.validFrom, cp.validTo);
              if (dateCheck.valid) {
                matchedCustomerPrice = cp;
                break;
              } else if (dateCheck.isExpiredOrFuture) {
                lineFlags.add("EXPIRED_RULE_IGNORED");
                orderFlagsSet.add("EXPIRED_RULE_IGNORED");
              }
            }
          }
        }
      }

      if (matchedCustomerPrice !== null) {
        resolvedUnitPrice = matchedCustomerPrice.priceMinor;
      } else if (line.customerPriceMinor !== undefined && line.customerPriceMinor !== null) {
        resolvedUnitPrice = line.customerPriceMinor;
      } else if (line.basePriceMinor !== undefined && line.basePriceMinor !== null) {
        resolvedUnitPrice = line.basePriceMinor;
      } else {
        resolvedUnitPrice = 0;
        lineFlags.add("NO_PRICE");
        orderFlagsSet.add("NO_PRICE");
      }
    }

    const unitPriceMinor = resolvedUnitPrice ?? 0;
    const baseTotalMinor = Number.isInteger(quantity)
      ? quantity * unitPriceMinor
      : Math.round(quantity * unitPriceMinor);

    const taxRateBps = line.taxRateBps ?? taxConfig?.defaultTaxRateBps ?? 0;

    intermediateLines.push({
      input: line,
      quantity,
      unitPriceMinor,
      baseTotalMinor,
      lineDiscountMinor: 0,
      allocatedOrderDiscountMinor: 0,
      appliedDiscounts: [],
      flags: lineFlags,
      taxRateBps,
    });
  }

  // 2. Apply Line-Level Discounts (PRODUCT and CUSTOMER scopes)
  // Sorted by priority descending (higher priority applies first)
  const lineRules = discountRules
    .filter((r) => r.scope === "PRODUCT" || r.scope === "CUSTOMER")
    .slice()
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const item of intermediateLines) {
    let currentLineAmount = item.baseTotalMinor;

    for (const rule of lineRules) {
      // Check customer scope match
      if (rule.scope === "CUSTOMER") {
        if (rule.customerId && rule.customerId !== customer?.id) continue;
        if (rule.productId && rule.productId !== item.input.productId) continue;
      }

      // Check product scope match
      if (rule.scope === "PRODUCT") {
        if (rule.productId && rule.productId !== item.input.productId) continue;
        if (rule.customerId && rule.customerId !== customer?.id) continue;
      }

      // Check date validity
      const dateCheck = checkDateValidity(now, rule.validFrom, rule.validTo);
      if (!dateCheck.valid) {
        if (dateCheck.isExpiredOrFuture) {
          item.flags.add("EXPIRED_RULE_IGNORED");
          orderFlagsSet.add("EXPIRED_RULE_IGNORED");
        }
        continue;
      }

      // Check minQty edge
      if (rule.minQty !== null && rule.minQty !== undefined && item.quantity < rule.minQty) {
        continue;
      }

      // Calculate discount amount
      let discountAmt = 0;
      if (rule.type === "PERCENT") {
        const { numerator, denominator } = getPercentFraction(rule.value);
        discountAmt = roundHalfUp(currentLineAmount * numerator, denominator);
      } else if (rule.type === "FIXED") {
        const isPerUnit = rule.perUnit !== false;
        discountAmt = isPerUnit ? rule.value * item.quantity : rule.value;
      }

      item.lineDiscountMinor += discountAmt;
      currentLineAmount -= discountAmt;
      item.appliedDiscounts.push({
        ruleId: rule.id,
        scope: rule.scope,
        type: rule.type,
        value: rule.value,
        amountMinor: discountAmt,
      });
    }
  }

  // 3. Apply Order-Level Discounts (ORDER scope)
  // Applied on the discounted subtotal after line discounts
  const discountedSubtotalAfterLines = intermediateLines.reduce(
    (sum, item) => sum + (item.baseTotalMinor - item.lineDiscountMinor),
    0,
  );

  const orderRules = discountRules
    .filter((r) => r.scope === "ORDER")
    .slice()
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  let totalOrderLevelDiscount = 0;
  let remainingOrderSubtotal = discountedSubtotalAfterLines;

  for (const rule of orderRules) {
    if (rule.customerId && rule.customerId !== customer?.id) continue;

    const dateCheck = checkDateValidity(now, rule.validFrom, rule.validTo);
    if (!dateCheck.valid) {
      if (dateCheck.isExpiredOrFuture) {
        orderFlagsSet.add("EXPIRED_RULE_IGNORED");
      }
      continue;
    }

    if (rule.minOrderMinor !== null && rule.minOrderMinor !== undefined) {
      if (discountedSubtotalAfterLines < rule.minOrderMinor) {
        continue;
      }
    }

    if (rule.minQty !== null && rule.minQty !== undefined && totalOrderQty < rule.minQty) {
      continue;
    }

    let discountAmt = 0;
    if (rule.type === "PERCENT") {
      const { numerator, denominator } = getPercentFraction(rule.value);
      discountAmt = roundHalfUp(remainingOrderSubtotal * numerator, denominator);
    } else if (rule.type === "FIXED") {
      discountAmt = rule.value;
    }

    totalOrderLevelDiscount += discountAmt;
    remainingOrderSubtotal -= discountAmt;
  }

  // 4. Allocate Order-Level Discount Proportionally Across Lines
  // Using Hamilton largest-remainder method for integer paise allocation
  if (totalOrderLevelDiscount !== 0 && discountedSubtotalAfterLines > 0) {
    let allocatedTotal = 0;
    const shares: { index: number; floorShare: number; remainder: number }[] = [];

    for (let i = 0; i < intermediateLines.length; i++) {
      const linePostLineDiscount = intermediateLines[i].baseTotalMinor - intermediateLines[i].lineDiscountMinor;
      const exactShare = (linePostLineDiscount * totalOrderLevelDiscount) / discountedSubtotalAfterLines;
      const floorShare = Math.floor(exactShare);
      shares.push({
        index: i,
        floorShare,
        remainder: exactShare - floorShare,
      });
      allocatedTotal += floorShare;
    }

    // Distribute remaining paise
    const leftover = totalOrderLevelDiscount - allocatedTotal;
    shares.sort((a, b) => b.remainder - a.remainder);

    for (let k = 0; k < leftover; k++) {
      shares[k % shares.length].floorShare += 1;
    }

    for (const share of shares) {
      intermediateLines[share.index].allocatedOrderDiscountMinor = share.floorShare;
    }
  }

  // 5. Compute Post-Discount Amount, Taxes, and Totals
  const resultLines: PricedOrderLine[] = [];
  let subtotalMinor = 0;
  let totalDiscountMinor = 0;
  let totalTaxMinor = 0;
  let totalMinor = 0;

  for (const item of intermediateLines) {
    const lineDiscountMinor = item.lineDiscountMinor + item.allocatedOrderDiscountMinor;
    const netTotalMinor = item.baseTotalMinor - lineDiscountMinor;

    // Tax computed on post-discount amount using product taxRateBps, rounded half-up
    const taxMinor = roundHalfUp(netTotalMinor * item.taxRateBps, 10000);
    const lineTotalMinor = netTotalMinor + taxMinor;

    if (netTotalMinor < 0 || lineTotalMinor < 0) {
      item.flags.add("NEGATIVE_TOTAL");
      orderFlagsSet.add("NEGATIVE_TOTAL");
    }

    subtotalMinor += item.baseTotalMinor;
    totalDiscountMinor += lineDiscountMinor;
    totalTaxMinor += taxMinor;
    totalMinor += lineTotalMinor;

    // Merge line flags into order-level flags
    for (const f of item.flags) {
      orderFlagsSet.add(f);
    }

    resultLines.push({
      id: item.input.id,
      productId: item.input.productId,
      sku: item.input.sku,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      baseTotalMinor: item.baseTotalMinor,
      discountMinor: lineDiscountMinor,
      netTotalMinor,
      taxRateBps: item.taxRateBps,
      taxMinor,
      totalMinor: lineTotalMinor,
      flags: Array.from(item.flags),
      appliedDiscounts: item.appliedDiscounts,
    });
  }

  if (totalMinor < 0 || subtotalMinor - totalDiscountMinor < 0) {
    orderFlagsSet.add("NEGATIVE_TOTAL");
  }

  return {
    lines: resultLines,
    subtotalMinor,
    discountMinor: totalDiscountMinor,
    taxMinor: totalTaxMinor,
    totalMinor,
    flags: Array.from(orderFlagsSet),
  };
}
