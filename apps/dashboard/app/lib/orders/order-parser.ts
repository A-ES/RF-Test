import { prisma } from "@/app/lib/db";
import { rupeesToPaise, calculateOrderTotals } from "./money";

export interface MatchedOrderItemSpec {
  itemId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  totalPricePaise: number;
  availableStock: number;
  hasSufficientStock: boolean;
}

export interface OrderIntentParseResult {
  hasOrderIntent: boolean;
  confidence: number;
  items: MatchedOrderItemSpec[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  allStockAvailable: boolean;
  summary: string;
  requiresClarification: boolean;
  clarificationMessage?: string;
}

/**
 * Extracts candidate SKU or product keyword mentions and quantities from raw WhatsApp message body.
 * Handles patterns such as:
 * - "Need 5 units of MNT-MAST-CLAMP"
 * - "Please send 10x ANT-PATCH-5G"
 * - "Order 2 of enclosure"
 * - "CAB-LMR400-10M: 15"
 */
export function extractItemRequests(
  text: string,
): Array<{ rawQuery: string; quantity: number }> {
  const requests: Array<{ rawQuery: string; quantity: number }> = [];
  const cleaned = text.trim();

  // Regex patterns for quantity + item indicators
  const patterns = [
    // "10x SKU" or "10 x SKU"
    /\b(\d+)\s*x\s+([A-Za-z0-9-_]+)\b/gi,
    // "need 5 units of SKU" or "order 20 pieces of SKU"
    /\b(?:need|want|order|send|dispatch|buy|require)\s+(\d+)\s*(?:units?|pcs?|pieces?|items?)?(?:\s+of)?\s+([A-Za-z0-9-_]+)\b/gi,
    // "SKU: 10" or "SKU x 10"
    /\b([A-Za-z0-9-_]{3,20})\s*(?::|x)\s*(\d+)\b/gi,
  ];

  for (const match of cleaned.matchAll(patterns[0])) {
    const qty = Number.parseInt(match[1], 10);
    const query = match[2]?.trim();
    if (qty > 0 && query) {
      requests.push({ rawQuery: query, quantity: qty });
    }
  }

  for (const match of cleaned.matchAll(patterns[1])) {
    const qty = Number.parseInt(match[1], 10);
    const query = match[2]?.trim();
    if (qty > 0 && query && !requests.some((r) => r.rawQuery.toLowerCase() === query.toLowerCase())) {
      requests.push({ rawQuery: query, quantity: qty });
    }
  }

  for (const match of cleaned.matchAll(patterns[2])) {
    const query = match[1]?.trim();
    const qty = Number.parseInt(match[2], 10);
    if (qty > 0 && query && !requests.some((r) => r.rawQuery.toLowerCase() === query.toLowerCase())) {
      requests.push({ rawQuery: query, quantity: qty });
    }
  }

  return requests;
}

/**
 * Matches extracted product queries against the tenant's products, aliases, and inventory levels.
 */
export async function parseOrderFromMessage(
  organizationId: string,
  messageBody: string,
): Promise<OrderIntentParseResult> {
  const extracted = extractItemRequests(messageBody);

  const orderKeywords = /\b(order|purchase|quote|buy|dispatch|invoice|po)\b/i;
  const containsOrderKeyword = orderKeywords.test(messageBody);

  if (extracted.length === 0) {
    return {
      hasOrderIntent: containsOrderKeyword,
      confidence: containsOrderKeyword ? 0.3 : 0.0,
      items: [],
      subtotalPaise: 0,
      taxPaise: 0,
      totalPaise: 0,
      currency: "INR",
      allStockAvailable: false,
      summary: "No specific SKUs or quantities identified in message.",
      requiresClarification: containsOrderKeyword,
      clarificationMessage: containsOrderKeyword
        ? "We noticed you may want to place an order. Could you please specify the product SKU or name and desired quantity?"
        : undefined,
    };
  }

interface ProductCatalogItem {
  id: string;
  sku: string;
  name: string;
  basePriceMinor: number;
  aliases: Array<{ alias: string }>;
  inventoryLevel: { onHand: number; reserved: number } | null;
}

interface LegacyInventoryItem {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  unitPrice: unknown;
  stockLevels: Array<{ onHand: number; reserved: number }>;
}

  // Load tenant's products with aliases and inventory level
  const products: ProductCatalogItem[] = await prisma.product.findMany({
    where: { organizationId, isActive: true },
    select: {
      id: true,
      sku: true,
      name: true,
      basePriceMinor: true,
      aliases: { select: { alias: true } },
      inventoryLevel: { select: { onHand: true, reserved: true } },
    },
  });

  // Fallback to inventory items if products catalog is empty
  let legacyItems: LegacyInventoryItem[] = [];
  if (products.length === 0) {
    legacyItems = (await prisma.inventoryItem.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        barcode: true,
        unitPrice: true,
        stockLevels: { select: { onHand: true, reserved: true } },
      },
    })) as LegacyInventoryItem[];
  }

  const matchedItems: MatchedOrderItemSpec[] = [];

  for (const req of extracted) {
    const target = req.rawQuery.toLowerCase().replace(/[^a-z0-9-_]/g, "");

    // 1. Check Product table
    let matchedProduct = products.find((p) => p.sku.toLowerCase() === target);
    if (!matchedProduct) {
      matchedProduct = products.find((p) =>
        p.aliases.some((a) => a.alias.toLowerCase() === target || a.alias.includes(target)),
      );
    }
    if (!matchedProduct) {
      matchedProduct = products.find((p) =>
        p.name.toLowerCase().includes(req.rawQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(target),
      );
    }

    if (matchedProduct) {
      const onHand = matchedProduct.inventoryLevel?.onHand ?? 0;
      const reserved = matchedProduct.inventoryLevel?.reserved ?? 0;
      const availableStock = Math.max(0, onHand - reserved);
      const unitPricePaise = matchedProduct.basePriceMinor;
      const totalPricePaise = req.quantity * unitPricePaise;

      matchedItems.push({
        itemId: matchedProduct.id,
        sku: matchedProduct.sku,
        name: matchedProduct.name,
        quantity: req.quantity,
        unitPricePaise,
        totalPricePaise,
        availableStock,
        hasSufficientStock: availableStock >= req.quantity,
      });
      continue;
    }

    // 2. Check legacy InventoryItem table
    let matchedLegacy = legacyItems.find((i) => i.sku.toLowerCase() === target);
    if (!matchedLegacy) {
      matchedLegacy = legacyItems.find(
        (i) =>
          i.sku.toLowerCase().includes(target) ||
          (Boolean(i.barcode) && i.barcode?.toLowerCase() === target),
      );
    }
    if (!matchedLegacy) {
      matchedLegacy = legacyItems.find((i) =>
        i.name.toLowerCase().includes(req.rawQuery.toLowerCase()),
      );
    }

    if (matchedLegacy) {
      const availableStock = matchedLegacy.stockLevels.reduce(
        (sum, sl) => sum + Math.max(0, sl.onHand - sl.reserved),
        0,
      );
      const unitPricePaise = rupeesToPaise(matchedLegacy.unitPrice as number | string);
      const totalPricePaise = req.quantity * unitPricePaise;

      matchedItems.push({
        itemId: matchedLegacy.id,
        sku: matchedLegacy.sku,
        name: matchedLegacy.name,
        quantity: req.quantity,
        unitPricePaise,
        totalPricePaise,
        availableStock,
        hasSufficientStock: availableStock >= req.quantity,
      });
    }
  }

  if (matchedItems.length === 0) {
    return {
      hasOrderIntent: true,
      confidence: 0.45,
      items: [],
      subtotalPaise: 0,
      taxPaise: 0,
      totalPaise: 0,
      currency: "INR",
      allStockAvailable: false,
      summary: "Customer requested products, but no matching SKUs were found in the catalog.",
      requiresClarification: true,
      clarificationMessage:
        "We could not find the requested item in our catalog. Could you please confirm the SKU or product code?",
    };
  }

  const totals = calculateOrderTotals(
    matchedItems.map((m) => ({
      quantity: m.quantity,
      unitPricePaise: m.unitPricePaise,
    })),
  );

  const allStockAvailable = matchedItems.every((m) => m.hasSufficientStock);
  const itemsSummary = matchedItems
    .map(
      (m) =>
        `${m.quantity}x ${m.sku} (${m.name}) @ ₹${(m.unitPricePaise / 100).toFixed(2)}${m.hasSufficientStock ? "" : " [LOW STOCK]"}`,
    )
    .join(", ");

  return {
    hasOrderIntent: true,
    confidence: allStockAvailable ? 0.92 : 0.75,
    items: matchedItems,
    subtotalPaise: totals.subtotalPaise,
    taxPaise: totals.taxPaise,
    totalPaise: totals.totalPaise,
    currency: "INR",
    allStockAvailable,
    summary: `Matched: ${itemsSummary}. Total: ₹${(totals.totalPaise / 100).toFixed(2)}`,
    requiresClarification: !allStockAvailable,
    clarificationMessage: !allStockAvailable
      ? "Some of the items you requested have limited inventory. Our team will verify availability."
      : undefined,
  };
}
