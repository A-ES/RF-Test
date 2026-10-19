import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { computeInventoryStatus } from "@/app/lib/inventory-status";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MovementTypeEnum = z.enum([
  "RECEIPT",
  "SHIPMENT",
  "TRANSFER",
  "ADJUSTMENT",
  "RETURN",
  "WASTAGE",
]);

const adjustStockSchema = z.object({
  itemId: z.string().min(1, "itemId is required"),
  locationId: z.string().min(1, "locationId is required"),
  type: MovementTypeEnum,
  quantity: z.number().int().positive("quantity must be a positive integer"),
  delta: z.number().int().optional(), // Used if type is ADJUSTMENT to allow + or - delta
  reason: z.string().max(100).optional(),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  toLocationId: z.string().optional(),
});

/**
 * POST /api/inventory/stock/adjust
 * Atomic stock adjustment in a single prisma.$transaction:
 * 1. Reads & locks/upserts current InventoryStockLevel
 * 2. Computes new onHand (guarded against negative balances)
 * 3. Creates movement(s) with performedById = current user
 * 4. Handles TRANSFER by debiting from source and crediting to destination
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = adjustStockSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Verify item belongs to org
  const item = await prisma.inventoryItem.findFirst({
    where: { id: data.itemId, organizationId: session.organizationId },
    select: {
      id: true,
      sku: true,
      name: true,
      reorderPoint: true,
      targetStock: true,
      unit: true,
      unitPrice: true,
      expiryTrackingEnabled: true,
    },
  });

  if (!item) {
    const product = await prisma.product.findFirst({
      where: {
        organizationId: session.organizationId,
        OR: [{ id: data.itemId }, { sku: data.itemId }],
      },
      include: { inventoryLevel: true },
    });

    if (product) {
      let effectiveDelta = 0;
      if (data.type === "RECEIPT" || data.type === "RETURN") {
        effectiveDelta = data.quantity;
      } else if (data.type === "SHIPMENT" || data.type === "WASTAGE") {
        effectiveDelta = -data.quantity;
      } else if (data.type === "ADJUSTMENT") {
        effectiveDelta = data.delta !== undefined ? data.delta : data.quantity;
      }

      const currentOnHand = product.inventoryLevel?.onHand ?? 0;
      const newOnHand = Math.max(0, currentOnHand + effectiveDelta);

      await prisma.$transaction([
        prisma.inventoryLevel.upsert({
          where: {
            organizationId_productId: {
              organizationId: session.organizationId,
              productId: product.id,
            },
          },
          create: {
            organizationId: session.organizationId,
            productId: product.id,
            onHand: newOnHand,
            reserved: 0,
          },
          update: {
            onHand: newOnHand,
          },
        }),
        prisma.stockMovement.create({
          data: {
            organizationId: session.organizationId,
            productId: product.id,
            delta: effectiveDelta,
            reason: "ADJUSTMENT",
            actorId: session.userId,
          },
        }),
      ]);

      const status = computeInventoryStatus({
        onHand: newOnHand,
        reorderPoint: product.reorderLevel,
        targetStock: product.reorderLevel * 3,
        expiryTrackingEnabled: false,
      });

      return Response.json({
        success: true,
        item: {
          id: product.id,
          sku: product.sku,
          name: product.name,
          onHand: newOnHand,
          status,
          stockLevels: [
            {
              locationId: data.locationId,
              onHand: newOnHand,
              reserved: product.inventoryLevel?.reserved ?? 0,
              available: Math.max(0, newOnHand - (product.inventoryLevel?.reserved ?? 0)),
            },
          ],
        },
      });
    }

    return Response.json({ error: "Item not found in your organization" }, { status: 404 });
  }

  // Verify source location belongs to org
  const sourceLoc = await prisma.inventoryLocation.findFirst({
    where: { id: data.locationId, organizationId: session.organizationId },
    select: { id: true, code: true, name: true },
  });

  if (!sourceLoc) {
    return Response.json({ error: "Source location not found in your organization" }, { status: 404 });
  }

  // If transfer, verify destination location
  if (data.type === "TRANSFER") {
    if (!data.toLocationId) {
      return Response.json({ error: "toLocationId is required for TRANSFER" }, { status: 400 });
    }
    if (data.toLocationId === data.locationId) {
      return Response.json({ error: "Cannot transfer to the same location" }, { status: 400 });
    }
    const toLoc = await prisma.inventoryLocation.findFirst({
      where: { id: data.toLocationId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!toLoc) {
      return Response.json({ error: "Destination location not found in your organization" }, { status: 404 });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Get or create source stock level
      let sourceStock = await tx.inventoryStockLevel.findUnique({
        where: {
          itemId_locationId: {
            itemId: data.itemId,
            locationId: data.locationId,
          },
        },
      });

      if (!sourceStock) {
        sourceStock = await tx.inventoryStockLevel.create({
          data: {
            itemId: data.itemId,
            locationId: data.locationId,
            onHand: 0,
            reserved: 0,
          },
        });
      }

      // 2. Calculate delta
      let delta = 0;
      if (data.type === "RECEIPT" || data.type === "RETURN") {
        delta = data.quantity;
      } else if (data.type === "SHIPMENT" || data.type === "WASTAGE" || data.type === "TRANSFER") {
        delta = -data.quantity;
      } else if (data.type === "ADJUSTMENT") {
        // If an explicit delta was provided, use it; otherwise treat quantity as absolute or delta
        delta = data.delta !== undefined ? data.delta : data.quantity;
      }

      const newSourceOnHand = sourceStock.onHand + delta;

      if (newSourceOnHand < 0) {
        throw new Error(`INSUFFICIENT_STOCK: Current on-hand is ${sourceStock.onHand}, cannot reduce by ${Math.abs(delta)}`);
      }

      // Update source stock level
      const updatedSourceStock = await tx.inventoryStockLevel.update({
        where: { id: sourceStock.id },
        data: {
          onHand: newSourceOnHand,
        },
      });

      // Log movement for source location
      const sourceMovement = await tx.inventoryMovement.create({
        data: {
          organizationId: session.organizationId,
          itemId: data.itemId,
          locationId: data.locationId,
          type: data.type,
          quantity: Math.abs(data.quantity),
          reason: data.reason || (delta >= 0 ? "STOCK_IN" : "STOCK_OUT"),
          reference: data.reference || `ADJ-${Date.now()}`,
          notes: data.notes || undefined,
          performedById: session.userId,
        },
      });

      let updatedDestStock = null;

      // 3. If TRANSFER, update destination stock level and create corresponding movement
      if (data.type === "TRANSFER" && data.toLocationId) {
        let destStock = await tx.inventoryStockLevel.findUnique({
          where: {
            itemId_locationId: {
              itemId: data.itemId,
              locationId: data.toLocationId,
            },
          },
        });

        if (!destStock) {
          destStock = await tx.inventoryStockLevel.create({
            data: {
              itemId: data.itemId,
              locationId: data.toLocationId,
              onHand: 0,
              reserved: 0,
            },
          });
        }

        updatedDestStock = await tx.inventoryStockLevel.update({
          where: { id: destStock.id },
          data: {
            onHand: destStock.onHand + data.quantity,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            organizationId: session.organizationId,
            itemId: data.itemId,
            locationId: data.toLocationId,
            type: "RECEIPT",
            quantity: data.quantity,
            reason: "TRANSFER_IN",
            reference: data.reference || sourceMovement.reference || `TRF-${Date.now()}`,
            notes: `Transferred in from ${sourceLoc.code}`,
            performedById: session.userId,
          },
        });
      }

      // 4. Compute updated total onHand and status for the item
      const allStockLevels = await tx.inventoryStockLevel.findMany({
        where: { itemId: data.itemId },
      });
      const totalOnHand = allStockLevels.reduce((sum, sl) => sum + sl.onHand, 0);

      const latestBatch = await tx.inventoryBatch.findFirst({
        where: { itemId: data.itemId, expiryDate: { not: null } },
        orderBy: { expiryDate: "asc" },
      });

      const newStatus = computeInventoryStatus({
        onHand: totalOnHand,
        reorderPoint: item.reorderPoint,
        targetStock: item.targetStock,
        nearestExpiry: latestBatch?.expiryDate ?? null,
        expiryTrackingEnabled: item.expiryTrackingEnabled,
      });

      return {
        success: true,
        item: {
          id: item.id,
          sku: item.sku,
          name: item.name,
          onHand: totalOnHand,
          status: newStatus,
          stockValue: totalOnHand * Number(item.unitPrice),
        },
        sourceStockLevel: {
          locationId: updatedSourceStock.locationId,
          onHand: updatedSourceStock.onHand,
        },
        destStockLevel: updatedDestStock
          ? {
              locationId: updatedDestStock.locationId,
              onHand: updatedDestStock.onHand,
            }
          : null,
        movement: {
          id: sourceMovement.id,
          type: sourceMovement.type,
          quantity: sourceMovement.quantity,
          timestamp: sourceMovement.timestamp.toISOString(),
        },
      };
    });

    return Response.json(result);
  } catch (err: any) {
    if (typeof err?.message === "string" && err.message.startsWith("INSUFFICIENT_STOCK")) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/inventory/stock/adjust error:", err);
    return Response.json({ error: "Failed to record stock adjustment" }, { status: 500 });
  }
}
