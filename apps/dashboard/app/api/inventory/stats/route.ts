import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { computeInventoryStatus } from "@/app/lib/inventory-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/inventory/stats
 * Computes:
 * - totalStockValue
 * - lowStockCount
 * - outOfStockCount
 * - deadStockCount (items with no movements in the last 60 days)
 * - expiringCount (batches expiring within 30 days)
 * - byLocation: [{ locationId, locationName, locationCode, healthy, low, out, stockValue }]
 *
 * Designed to execute in minimum DB round trips (2-3 queries total, no N+1).
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.organizationId;
  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000);
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 86_400_000);

  // Round trip 1: Fetch all locations for this org
  const locationsPromise = prisma.inventoryLocation.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });

  // Round trip 2: Fetch items with their stock levels and nearest expiry in a single query
  const itemsPromise = prisma.inventoryItem.findMany({
    where: { organizationId: orgId, isActive: true },
    select: {
      id: true,
      unitPrice: true,
      reorderPoint: true,
      targetStock: true,
      expiryTrackingEnabled: true,
      stockLevels: {
        select: {
          locationId: true,
          onHand: true,
        },
      },
      batches: {
        where: { expiryDate: { not: null, lte: thirtyDaysFromNow, gte: now } },
        select: { id: true },
        take: 1,
      },
    },
  });

  // Round trip 3: Item IDs that had any movements in the last 60 days
  const activeMovementItemsPromise = prisma.inventoryMovement.findMany({
    where: {
      organizationId: orgId,
      timestamp: { gte: sixtyDaysAgo },
    },
    distinct: ["itemId"],
    select: { itemId: true },
  });

  const productsPromise = prisma.product.findMany({
    where: { organizationId: orgId, isActive: true },
    select: {
      id: true,
      sku: true,
      basePriceMinor: true,
      reorderLevel: true,
      inventoryLevel: {
        select: { onHand: true, reserved: true },
      },
    },
  });

  const [locations, items, activeMovements, products] = await Promise.all([
    locationsPromise,
    itemsPromise,
    activeMovementItemsPromise,
    productsPromise,
  ]);

  const activeItemIds = new Set(activeMovements.map((m) => m.itemId));

  let totalStockValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let deadStockCount = 0;
  let expiringCount = 0;

  // Track per-location distribution stats
  const locationStatsMap = new Map<
    string,
    { healthy: number; low: number; out: number; stockValue: number }
  >();

  for (const loc of locations) {
    locationStatsMap.set(loc.id, { healthy: 0, low: 0, out: 0, stockValue: 0 });
  }

  for (const item of items) {
    const unitPrice = Number(item.unitPrice);
    const itemTotalOnHand = item.stockLevels.reduce((acc, sl) => acc + sl.onHand, 0);
    totalStockValue += itemTotalOnHand * unitPrice;

    if (item.batches.length > 0) {
      expiringCount++;
    }

    if (!activeItemIds.has(item.id) && itemTotalOnHand > 0) {
      deadStockCount++;
    }

    const overallStatus = computeInventoryStatus({
      onHand: itemTotalOnHand,
      reorderPoint: item.reorderPoint,
      targetStock: item.targetStock,
      expiryTrackingEnabled: item.expiryTrackingEnabled,
    });

    if (overallStatus === "OUT") {
      outOfStockCount++;
    } else if (overallStatus === "LOW") {
      lowStockCount++;
    }

    // Distribute item stock per location
    for (const loc of locations) {
      const stat = locationStatsMap.get(loc.id)!;
      const sl = item.stockLevels.find((s) => s.locationId === loc.id);
      const locOnHand = sl?.onHand ?? 0;

      stat.stockValue += locOnHand * unitPrice;

      if (locOnHand === 0) {
        stat.out++;
      } else if (locOnHand <= Math.ceil(item.reorderPoint / Math.max(1, locations.length))) {
        stat.low++;
      } else {
        stat.healthy++;
      }
    }
  }

  // ── Bridge Catalog Products into Stats ─────────────────────────────────
  const existingItemSkus = new Set(items.map((i) => i.id));
  const defaultLocId = locations[0]?.id;

  for (const product of products) {
    if (existingItemSkus.has(product.id)) continue;

    const unitPrice = product.basePriceMinor / 100;
    const onHand = product.inventoryLevel?.onHand ?? 0;
    const stockVal = onHand * unitPrice;
    totalStockValue += stockVal;

    const status = computeInventoryStatus({
      onHand,
      reorderPoint: product.reorderLevel,
      targetStock: product.reorderLevel * 3,
      expiryTrackingEnabled: false,
    });

    if (status === "OUT") {
      outOfStockCount++;
    } else if (status === "LOW") {
      lowStockCount++;
    }

    if (defaultLocId && locationStatsMap.has(defaultLocId)) {
      const stat = locationStatsMap.get(defaultLocId)!;
      stat.stockValue += stockVal;
      if (onHand === 0) stat.out++;
      else if (onHand <= product.reorderLevel) stat.low++;
      else stat.healthy++;
    }
  }

  const byLocation = locations.map((loc) => {
    const s = locationStatsMap.get(loc.id)!;
    return {
      locationId: loc.id,
      locationName: loc.name,
      locationCode: loc.code,
      healthy: s.healthy,
      low: s.low,
      out: s.out,
      stockValue: Math.round(s.stockValue),
    };
  });

  return Response.json({
    totalStockValue: Math.round(totalStockValue * 100) / 100,
    lowStockCount,
    outOfStockCount,
    deadStockCount,
    expiringCount,
    totalSkus: items.length,
    byLocation,
  });
}
