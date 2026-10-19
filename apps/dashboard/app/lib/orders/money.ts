import { Prisma } from "@rf-intelligence/db";

/**
 * Money calculations strictly operating in integer minor units (paise).
 * Non-negotiable rule: No floats for money. All values stored in DB are integer paise.
 */

export const DEFAULT_CURRENCY = "INR";

/**
 * Converts decimal rupees (from string, number, or Prisma.Decimal) to integer paise.
 * Rounds to nearest integer to avoid float representation artifacts.
 */
export function rupeesToPaise(rupees: number | string | Prisma.Decimal): number {
  if (rupees instanceof Prisma.Decimal) {
    return Math.round(rupees.times(100).toNumber());
  }

  const num = typeof rupees === "string" ? Number.parseFloat(rupees) : rupees;
  if (!Number.isFinite(num)) {
    throw new TypeError(`Invalid money amount: ${String(rupees)}`);
  }

  return Math.round(num * 100);
}

/**
 * Converts integer paise back to human-readable rupees string with 2 decimal places.
 */
export function paiseToRupeesString(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new TypeError(`Paise amount must be an integer, received: ${paise}`);
  }
  const isNegative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  const formatted = `${rupees}.${remainder.toString().padStart(2, "0")}`;
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Formats integer paise with currency symbol / code.
 * e.g. formatMoney(125050, "INR") -> "₹1,250.50"
 */
export function formatMoney(paise: number, currency = DEFAULT_CURRENCY): string {
  const rupees = paise / 100;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(rupees);
  } catch {
    return `${currency} ${paiseToRupeesString(paise)}`;
  }
}

export const formatMinorUnits = formatMoney;

export interface LineItemCalculationInput {
  quantity: number;
  unitPricePaise: number;
}

export interface OrderTotalCalculation {
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
}

/**
 * Calculates line total and order subtotal/tax/total using integer arithmetic.
 */
export function calculateLineTotalPaise(quantity: number, unitPricePaise: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new TypeError(`Quantity must be a positive integer, received: ${quantity}`);
  }
  if (!Number.isInteger(unitPricePaise) || unitPricePaise < 0) {
    throw new TypeError(`Unit price in paise must be a non-negative integer, received: ${unitPricePaise}`);
  }
  return quantity * unitPricePaise;
}

/**
 * Calculates order subtotal, tax (e.g. GST rate as percentage basis points or standard rate),
 * and total in integer paise.
 *
 * @param items Array of line items with quantity and unitPricePaise
 * @param taxRateBasisPoints e.g. 1800 for 18% GST (1800 / 10000)
 */
export function calculateOrderTotals(
  items: readonly LineItemCalculationInput[],
  taxRateBasisPoints = 1800, // 18% GST default in basis points
): OrderTotalCalculation {
  const subtotalPaise = items.reduce((sum, item) => {
    return sum + calculateLineTotalPaise(item.quantity, item.unitPricePaise);
  }, 0);

  // integer arithmetic: (subtotal * 1800 + 5000) / 10000 for standard rounding
  const taxPaise = Math.round((subtotalPaise * taxRateBasisPoints) / 10_000);
  const totalPaise = subtotalPaise + taxPaise;

  return {
    subtotalPaise,
    taxPaise,
    totalPaise,
  };
}
