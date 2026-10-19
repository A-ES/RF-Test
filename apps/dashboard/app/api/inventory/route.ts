import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import type { Prisma } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * GET /api/inventory — Returns product stock inventory summary and items for the tenant.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const filter = searchParams.get("filter") || "ALL"; // ALL | LOW_STOCK | OUT_OF_STOCK | IN_STOCK
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  const orgId = session.organizationId;

  const where: Prisma.ProductWhereInput = {
    organizationId: orgId,
    isActive: true,
  };

  if (search) {
    where.OR = [
      { sku: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      {
        aliases: {
          some: {
            alias: { contains: search.toLowerCase(), mode: "insensitive" },
          },
        },
      },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { sku: "asc" },
      take: limit,
      skip: offset,
      include: {
        inventoryLevel: true,
        aliases: { select: { alias: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  let totalOnHand = 0;
  let totalReserved = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  const items = products.map((p) => {
    const onHand = p.inventoryLevel?.onHand ?? 0;
    const reserved = p.inventoryLevel?.reserved ?? 0;
    const available = onHand - reserved;
    const isReorderNeeded = available <= p.reorderLevel;

    totalOnHand += onHand;
    totalReserved += reserved;
    if (available <= 0) outOfStockCount++;
    else if (isReorderNeeded) lowStockCount++;

    let status = "IN_STOCK";
    if (available <= 0) status = "OUT_OF_STOCK";
    else if (isReorderNeeded) status = "LOW_STOCK";

    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      basePriceMinor: p.basePriceMinor,
      reorderLevel: p.reorderLevel,
      onHand,
      reserved,
      available,
      status,
      isReorderNeeded,
      aliases: p.aliases.map((a) => a.alias),
      updatedAt: p.inventoryLevel?.updatedAt || p.updatedAt,
    };
  });

  // Optional client-side status filtering if specified
  const filteredItems = filter === "ALL"
    ? items
    : items.filter((i) => i.status === filter);

  return json({
    items: filteredItems,
    total,
    kpis: {
      totalProducts: total,
      totalOnHand,
      totalReserved,
      totalAvailable: totalOnHand - totalReserved,
      lowStockCount,
      outOfStockCount,
    },
  });
}
