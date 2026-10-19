import { getSession } from "@/app/lib/session";
import { prisma, Prisma } from "@/app/lib/db";
import { computeInventoryStatus, type InventoryStatus } from "@/app/lib/inventory-status";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InventoryUnitEnum = z.enum(["PCS", "KG", "G", "PACKS", "LITRES", "ML", "UNITS"]);

const createItemSchema = z.object({
  sku: z.string().max(50).optional(),
  name: z.string().min(1, "Name is required").max(150),
  categoryId: z.string().optional().nullable(),
  unit: InventoryUnitEnum.default("UNITS"),
  costPrice: z.number().nonnegative("Cost price must be non-negative"),
  unitPrice: z.number().nonnegative("Unit price must be non-negative"),
  reorderPoint: z.number().int().nonnegative().default(0),
  targetStock: z.number().int().nonnegative().default(0),
  description: z.string().max(1000).optional().nullable(),
  expiryTrackingEnabled: z.boolean().default(false),
  initialStock: z
    .object({
      locationId: z.string().min(1, "Location is required for initial stock"),
      quantity: z.number().int().positive("Initial quantity must be greater than 0"),
      expiryDate: z.string().optional().nullable(),
    })
    .optional(),
});

/**
 * Auto-generate SKU based on category name or prefix: CAT-####
 */
async function generateSku(organizationId: string, categoryId?: string | null): Promise<string> {
  let prefix = "ITEM";
  if (categoryId) {
    const cat = await prisma.inventoryCategory.findFirst({
      where: { id: categoryId, organizationId },
      select: { name: true },
    });
    if (cat?.name) {
      prefix = cat.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "ITEM";
    }
  }

  // Count existing items with this prefix for this org to generate an incremental code
  const count = await prisma.inventoryItem.count({
    where: {
      organizationId,
      sku: { startsWith: `${prefix}-` },
    },
  });

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${(count + 1).toString().padStart(3, "0")}-${randomSuffix}`;
}

/**
 * GET /api/inventory/items
 * Query params: search, categoryId, locationId, status, page, pageSize, sort
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const categoryId = url.searchParams.get("categoryId") || "";
  const locationId = url.searchParams.get("locationId") || "";
  const statusFilter = url.searchParams.get("status") || "ALL";
  const sort = url.searchParams.get("sort") || "name";
  const order = url.searchParams.get("order") === "desc" ? "desc" : "asc";

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));

  // Build Prisma where
  const where: Prisma.InventoryItemWhereInput = {
    organizationId: session.organizationId,
  };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  if (categoryId && categoryId !== "ALL") {
    where.categoryId = categoryId;
  }

  if (locationId && locationId !== "ALL") {
    where.stockLevels = {
      some: {
        locationId,
        onHand: { gt: 0 },
      },
    };
  }

  // Single query for items with select to avoid over-fetching
  const items = await prisma.inventoryItem.findMany({
    where,
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      categoryId: true,
      category: {
        select: { id: true, name: true },
      },
      unit: true,
      costPrice: true,
      unitPrice: true,
      reorderPoint: true,
      targetStock: true,
      expiryTrackingEnabled: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      stockLevels: {
        select: {
          id: true,
          locationId: true,
          onHand: true,
          reserved: true,
          updatedAt: true,
          location: {
            select: { id: true, name: true, code: true },
          },
        },
      },
      batches: {
        where: { expiryDate: { not: null } },
        orderBy: { expiryDate: "asc" },
        take: 1,
        select: { expiryDate: true },
      },
    },
  });

  // Compute status and onHand aggregated across locations (or for selected location)
  const mappedItems = items.map((item) => {
    let relevantOnHand = 0;
    if (locationId && locationId !== "ALL") {
      const match = item.stockLevels.find((sl) => sl.locationId === locationId);
      relevantOnHand = match?.onHand ?? 0;
    } else {
      relevantOnHand = item.stockLevels.reduce((sum, sl) => sum + sl.onHand, 0);
    }

    const nearestExpiry = item.batches[0]?.expiryDate ?? null;
    const computedStatus = computeInventoryStatus({
      onHand: relevantOnHand,
      reorderPoint: item.reorderPoint,
      targetStock: item.targetStock,
      nearestExpiry,
      expiryTrackingEnabled: item.expiryTrackingEnabled,
    });

    const unitPriceNum = Number(item.unitPrice);
    const costPriceNum = Number(item.costPrice);
    const stockValue = relevantOnHand * unitPriceNum;

    return {
      id: item.id,
      sku: item.sku,
      barcode: item.barcode,
      name: item.name,
      categoryId: item.categoryId,
      category: item.category?.name ?? "Uncategorized",
      unit: item.unit,
      costPrice: costPriceNum,
      unitPrice: unitPriceNum,
      reorderPoint: item.reorderPoint,
      targetStock: item.targetStock,
      expiryTrackingEnabled: item.expiryTrackingEnabled,
      description: item.description,
      isActive: item.isActive,
      onHand: relevantOnHand,
      status: computedStatus,
      stockValue,
      nearestExpiry: nearestExpiry ? nearestExpiry.toISOString() : null,
      stockLevels: item.stockLevels.map((sl) => ({
        id: sl.id,
        locationId: sl.locationId,
        locationName: sl.location.name,
        locationCode: sl.location.code,
        onHand: sl.onHand,
        reserved: sl.reserved,
        available: Math.max(0, sl.onHand - sl.reserved),
      })),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  });

  // ── Bridge Catalog Products into Inventory ──────────────────────────────
  const existingSkus = new Set(items.map((i) => i.sku.toLowerCase()));
  const defaultLoc = await prisma.inventoryLocation.findFirst({
    where: { organizationId: session.organizationId },
    orderBy: { code: "asc" },
  });

  const productWhere: Prisma.ProductWhereInput = {
    organizationId: session.organizationId,
    isActive: true,
  };
  if (search) {
    productWhere.OR = [
      { sku: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      {
        aliases: {
          some: {
            alias: { contains: search.toLowerCase(), mode: "insensitive" },
          },
        },
      },
    ];
  }

  if (!categoryId || categoryId === "ALL") {
    const products = await prisma.product.findMany({
      where: productWhere,
      include: {
        inventoryLevel: true,
      },
    });

    for (const p of products) {
      if (existingSkus.has(p.sku.toLowerCase())) continue;

      const onHand = p.inventoryLevel?.onHand ?? 0;
      const reserved = p.inventoryLevel?.reserved ?? 0;
      const available = Math.max(0, onHand - reserved);

      let relevantOnHand = onHand;
      if (locationId && locationId !== "ALL") {
        if (defaultLoc && defaultLoc.id !== locationId) {
          relevantOnHand = 0;
        }
      }

      const computedStatus = computeInventoryStatus({
        onHand: relevantOnHand,
        reorderPoint: p.reorderLevel,
        targetStock: p.reorderLevel * 3,
        nearestExpiry: null,
        expiryTrackingEnabled: false,
      });

      const unitPriceNum = p.basePriceMinor / 100;
      const costPriceNum = Math.round(p.basePriceMinor * 0.6) / 100;
      const stockValue = relevantOnHand * unitPriceNum;

      mappedItems.push({
        id: p.id,
        sku: p.sku,
        barcode: null,
        name: p.name,
        categoryId: null,
        category: "RF Products",
        unit: (p.unit?.toUpperCase() as any) || "PCS",
        costPrice: costPriceNum,
        unitPrice: unitPriceNum,
        reorderPoint: p.reorderLevel,
        targetStock: p.reorderLevel * 3,
        expiryTrackingEnabled: false,
        description: p.description,
        isActive: p.isActive,
        onHand: relevantOnHand,
        status: computedStatus,
        stockValue,
        nearestExpiry: null,
        stockLevels: [
          {
            id: p.inventoryLevel?.id || `sl_${p.id}`,
            locationId: defaultLoc?.id || "main",
            locationName: defaultLoc?.name || "Main Distribution Hub",
            locationCode: defaultLoc?.code || "MAIN",
            onHand,
            reserved,
            available,
          },
        ],
        createdAt: p.createdAt.toISOString(),
        updatedAt: (p.inventoryLevel?.updatedAt || p.updatedAt).toISOString(),
      });
    }
  }

  // Filter by computed status if requested
  const filtered = statusFilter === "ALL"
    ? mappedItems
    : mappedItems.filter((i) => i.status === statusFilter);

  // In-memory sort since status & onHand are computed
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sort === "stockValue") {
      cmp = a.stockValue - b.stockValue;
    } else if (sort === "onHand") {
      cmp = a.onHand - b.onHand;
    } else if (sort === "status") {
      cmp = a.status.localeCompare(b.status);
    } else if (sort === "sku") {
      cmp = a.sku.localeCompare(b.sku);
    } else if (sort === "unitPrice") {
      cmp = a.unitPrice - b.unitPrice;
    } else {
      cmp = a.name.localeCompare(b.name);
    }
    return order === "desc" ? -cmp : cmp;
  });

  const totalCount = filtered.length;
  const startIndex = (page - 1) * pageSize;
  const paginated = filtered.slice(startIndex, startIndex + pageSize);

  return Response.json({
    items: paginated,
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    },
  });
}

/**
 * POST /api/inventory/items
 * Creates item and optional initial stock in a single minimal prisma.$transaction
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

  const parsed = createItemSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const sku = data.sku?.trim() || (await generateSku(session.organizationId, data.categoryId));

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create item
      const item = await tx.inventoryItem.create({
        data: {
          organizationId: session.organizationId,
          sku,
          name: data.name.trim(),
          categoryId: data.categoryId || null,
          unit: data.unit,
          costPrice: new Prisma.Decimal(data.costPrice),
          unitPrice: new Prisma.Decimal(data.unitPrice),
          reorderPoint: data.reorderPoint,
          targetStock: data.targetStock,
          expiryTrackingEnabled: data.expiryTrackingEnabled,
          description: data.description?.trim() || null,
        },
        include: {
          category: { select: { id: true, name: true } },
        },
      });

      let onHand = 0;
      let nearestExpiry: Date | null = null;

      // 2. Optional initial stock
      if (data.initialStock && data.initialStock.quantity > 0) {
        onHand = data.initialStock.quantity;
        const locId = data.initialStock.locationId;

        // Verify location belongs to organization
        const loc = await tx.inventoryLocation.findFirst({
          where: { id: locId, organizationId: session.organizationId },
        });
        if (!loc) {
          throw new Error("LOCATION_NOT_FOUND");
        }

        await tx.inventoryStockLevel.create({
          data: {
            itemId: item.id,
            locationId: locId,
            onHand: data.initialStock.quantity,
            reserved: 0,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            organizationId: session.organizationId,
            itemId: item.id,
            locationId: locId,
            type: "RECEIPT",
            quantity: data.initialStock.quantity,
            reason: "VENDOR_RESTOCK",
            reference: "Initial stock",
            performedById: session.userId,
          },
        });

        if (data.expiryTrackingEnabled && data.initialStock.expiryDate) {
          nearestExpiry = new Date(data.initialStock.expiryDate);
          await tx.inventoryBatch.create({
            data: {
              itemId: item.id,
              batchCode: `BATCH-${sku}-INIT`,
              quantity: data.initialStock.quantity,
              expiryDate: nearestExpiry,
            },
          });
        }
      }

      const computedStatus = computeInventoryStatus({
        onHand,
        reorderPoint: item.reorderPoint,
        targetStock: item.targetStock,
        nearestExpiry,
        expiryTrackingEnabled: item.expiryTrackingEnabled,
      });

      return {
        item: {
          id: item.id,
          sku: item.sku,
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
          onHand,
          status: computedStatus,
          stockValue: onHand * Number(item.unitPrice),
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        },
      };
    });

    return Response.json(result, { status: 201 });
  } catch (err: any) {
    if (err?.message === "LOCATION_NOT_FOUND") {
      return Response.json({ error: "Selected location not found in this organization" }, { status: 400 });
    }
    if (err?.code === "P2002") {
      return Response.json({ error: `An item with SKU "${sku}" already exists.` }, { status: 409 });
    }
    console.error("POST /api/inventory/items error:", err);
    return Response.json({ error: "Failed to create inventory item" }, { status: 500 });
  }
}
