import { getSession } from "@/app/lib/session";
import { prisma, Prisma } from "@/app/lib/db";
import { computeInventoryStatus } from "@/app/lib/inventory-status";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchItemSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  categoryId: z.string().nullable().optional(),
  costPrice: z.number().nonnegative().optional(),
  unitPrice: z.number().nonnegative().optional(),
  reorderPoint: z.number().int().nonnegative().optional(),
  targetStock: z.number().int().nonnegative().optional(),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/inventory/items/[id]
 * Detail view: item info, per-location stock levels, last 90 days of movements, batches
 */
export async function GET(
  _request: Request,
  context: RouteParams
): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);

  // Single round trip with includes for stock levels, recent movements, and batches
  const item = await prisma.inventoryItem.findFirst({
    where: {
      id,
      organizationId: session.organizationId,
    },
    include: {
      category: { select: { id: true, name: true } },
      stockLevels: {
        include: {
          location: { select: { id: true, name: true, code: true } },
        },
      },
      batches: {
        orderBy: { expiryDate: "asc" },
      },
      movements: {
        where: { timestamp: { gte: ninetyDaysAgo } },
        orderBy: { timestamp: "desc" },
        take: 50,
        include: {
          location: { select: { id: true, name: true, code: true } },
          performedBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!item) {
    const product = await prisma.product.findFirst({
      where: {
        organizationId: session.organizationId,
        OR: [{ id }, { sku: id }],
      },
      include: {
        inventoryLevel: true,
        stockMovements: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            order: { select: { id: true, orderNumber: true, draftNumber: true } },
          },
        },
      },
    });

    if (product) {
      const defaultLoc = await prisma.inventoryLocation.findFirst({
        where: { organizationId: session.organizationId },
        orderBy: { code: "asc" },
      });
      const totalOnHand = product.inventoryLevel?.onHand ?? 0;
      const reserved = product.inventoryLevel?.reserved ?? 0;
      const status = computeInventoryStatus({
        onHand: totalOnHand,
        reorderPoint: product.reorderLevel,
        targetStock: product.reorderLevel * 3,
        nearestExpiry: null,
        expiryTrackingEnabled: false,
      });

      return Response.json({
        item: {
          id: product.id,
          sku: product.sku,
          barcode: null,
          name: product.name,
          categoryId: null,
          category: "RF Products",
          unit: product.unit,
          costPrice: Math.round(product.basePriceMinor * 0.6) / 100,
          unitPrice: product.basePriceMinor / 100,
          reorderPoint: product.reorderLevel,
          targetStock: product.reorderLevel * 3,
          expiryTrackingEnabled: false,
          description: product.description,
          isActive: product.isActive,
          onHand: totalOnHand,
          status,
          stockValue: totalOnHand * (product.basePriceMinor / 100),
          stockLevels: [
            {
              id: product.inventoryLevel?.id || `sl_${product.id}`,
              locationId: defaultLoc?.id || "loc_main",
              onHand: totalOnHand,
              reserved,
              location: {
                id: defaultLoc?.id || "loc_main",
                name: defaultLoc?.name || "Main Distribution Hub",
                code: defaultLoc?.code || "MAIN",
              },
            },
          ],
          batches: [],
          movements: product.stockMovements.map((sm) => ({
            id: sm.id,
            timestamp: sm.createdAt.toISOString(),
            type:
              sm.reason === "FULFILLMENT"
                ? "SHIPMENT"
                : sm.delta > 0
                  ? "RECEIPT"
                  : "ADJUSTMENT",
            quantity: Math.abs(sm.delta),
            notes: sm.order
              ? `Order ${sm.order.orderNumber || sm.order.draftNumber || sm.order.id}`
              : sm.reason,
            location: {
              name: defaultLoc?.name || "Main Distribution Hub",
              code: defaultLoc?.code || "MAIN",
            },
            performedBy: null,
          })),
        },
      });
    }

    return Response.json({ error: "Item not found" }, { status: 404 });
  }

  const totalOnHand = item.stockLevels.reduce((sum, sl) => sum + sl.onHand, 0);
  const nearestExpiry = item.batches[0]?.expiryDate ?? null;

  const status = computeInventoryStatus({
    onHand: totalOnHand,
    reorderPoint: item.reorderPoint,
    targetStock: item.targetStock,
    nearestExpiry,
    expiryTrackingEnabled: item.expiryTrackingEnabled,
  });

  return Response.json({
    item: {
      id: item.id,
      sku: item.sku,
      barcode: item.barcode,
      name: item.name,
      categoryId: item.categoryId,
      category: item.category?.name ?? "Uncategorized",
      unit: item.unit,
      costPrice: Number(item.costPrice),
      unitPrice: Number(item.unitPrice),
      reorderPoint: item.reorderPoint,
      targetStock: item.targetStock,
      expiryTrackingEnabled: item.expiryTrackingEnabled,
      description: item.description,
      isActive: item.isActive,
      onHand: totalOnHand,
      status,
      stockValue: totalOnHand * Number(item.unitPrice),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      stockLevels: item.stockLevels.map((sl) => ({
        id: sl.id,
        locationId: sl.locationId,
        locationName: sl.location.name,
        locationCode: sl.location.code,
        onHand: sl.onHand,
        reserved: sl.reserved,
        available: Math.max(0, sl.onHand - sl.reserved),
      })),
      batches: item.batches.map((b) => ({
        id: b.id,
        batchCode: b.batchCode,
        quantity: b.quantity,
        expiryDate: b.expiryDate ? b.expiryDate.toISOString() : null,
        receivedAt: b.receivedAt.toISOString(),
      })),
      movements: item.movements.map((m) => ({
        id: m.id,
        locationId: m.locationId,
        locationCode: m.location.code,
        locationName: m.location.name,
        type: m.type,
        quantity: m.quantity,
        reason: m.reason,
        reference: m.reference,
        notes: m.notes,
        performedBy: m.performedBy.name,
        timestamp: m.timestamp.toISOString(),
      })),
    },
  });
}

/**
 * PATCH /api/inventory/items/[id]
 * Partial update: name, categoryId, pricing, reorderPoint, targetStock, isActive
 */
export async function PATCH(
  request: Request,
  context: RouteParams
): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchItemSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const existing = await prisma.inventoryItem.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });

  if (!existing) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }

  const updateData: Prisma.InventoryItemUpdateInput = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
  if (parsed.data.categoryId !== undefined) {
    updateData.category = parsed.data.categoryId
      ? { connect: { id: parsed.data.categoryId } }
      : { disconnect: true };
  }
  if (parsed.data.costPrice !== undefined) {
    updateData.costPrice = new Prisma.Decimal(parsed.data.costPrice);
  }
  if (parsed.data.unitPrice !== undefined) {
    updateData.unitPrice = new Prisma.Decimal(parsed.data.unitPrice);
  }
  if (parsed.data.reorderPoint !== undefined) updateData.reorderPoint = parsed.data.reorderPoint;
  if (parsed.data.targetStock !== undefined) updateData.targetStock = parsed.data.targetStock;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  const updated = await prisma.inventoryItem.update({
    where: { id },
    data: updateData,
    include: {
      category: { select: { id: true, name: true } },
      stockLevels: true,
      batches: {
        where: { expiryDate: { not: null } },
        orderBy: { expiryDate: "asc" },
        take: 1,
      },
    },
  });

  const totalOnHand = updated.stockLevels.reduce((sum, sl) => sum + sl.onHand, 0);
  const nearestExpiry = updated.batches[0]?.expiryDate ?? null;

  const status = computeInventoryStatus({
    onHand: totalOnHand,
    reorderPoint: updated.reorderPoint,
    targetStock: updated.targetStock,
    nearestExpiry,
    expiryTrackingEnabled: updated.expiryTrackingEnabled,
  });

  return Response.json({
    item: {
      id: updated.id,
      sku: updated.sku,
      name: updated.name,
      categoryId: updated.categoryId,
      category: updated.category?.name ?? "Uncategorized",
      unit: updated.unit,
      costPrice: Number(updated.costPrice),
      unitPrice: Number(updated.unitPrice),
      reorderPoint: updated.reorderPoint,
      targetStock: updated.targetStock,
      expiryTrackingEnabled: updated.expiryTrackingEnabled,
      description: updated.description,
      isActive: updated.isActive,
      onHand: totalOnHand,
      status,
      stockValue: totalOnHand * Number(updated.unitPrice),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
