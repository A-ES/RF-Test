import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import type { Prisma } from "@rf-intelligence/db";
import { canWriteCatalog } from "@/app/lib/catalog/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * GET /api/products — Lists & searches catalog products for the current tenant.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const isActiveParam = searchParams.get("isActive");
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  const orgId = session.organizationId;

  // Build where conditions
  const where: Prisma.ProductWhereInput = {
    organizationId: orgId,
  };

  if (isActiveParam === "true") {
    where.isActive = true;
  } else if (isActiveParam === "false") {
    where.isActive = false;
  }

  if (search) {
    where.OR = [
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

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        aliases: {
          select: { id: true, alias: true },
        },
        inventoryLevel: {
          select: { onHand: true, reserved: true },
        },
        _count: {
          select: { customerPrices: true, discountRules: true },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const mapped = products.map((p) => {
    const onHand = p.inventoryLevel?.onHand ?? 0;
    const reserved = p.inventoryLevel?.reserved ?? 0;
    const available = onHand - reserved;
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      unit: p.unit,
      basePriceMinor: p.basePriceMinor,
      taxRateBps: p.taxRateBps,
      isActive: p.isActive,
      reorderLevel: p.reorderLevel,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      aliases: p.aliases,
      stock: {
        onHand,
        reserved,
        available,
        isReorderNeeded: available <= p.reorderLevel,
      },
      customerPricesCount: p._count.customerPrices,
      discountRulesCount: p._count.discountRules,
    };
  });

  return json({ products: mapped, total, limit, offset });
}

/**
 * POST /api/products — Creates a new catalog product (CLIENT_ADMIN or ADMIN only).
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (!canWriteCatalog(session.role)) {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const unit = typeof body.unit === "string" && body.unit.trim() ? body.unit.trim() : "PCS";
  const basePriceMinor = Number(body.basePriceMinor);
  const taxRateBps = body.taxRateBps !== undefined ? Number(body.taxRateBps) : 1800;
  const reorderLevel = body.reorderLevel !== undefined ? Number(body.reorderLevel) : 10;
  const isActive = body.isActive !== undefined ? Boolean(body.isActive) : true;
  const initialStock = body.initialStock !== undefined ? Number(body.initialStock) : 0;
  const rawAliases = Array.isArray(body.aliases) ? body.aliases : [];

  if (!sku) {
    return json({ error: "SKU is required" }, 400);
  }
  if (!name) {
    return json({ error: "Product name is required" }, 400);
  }
  if (!Number.isInteger(basePriceMinor) || basePriceMinor < 0) {
    return json({ error: "basePriceMinor must be a non-negative integer (paise)" }, 400);
  }
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0) {
    return json({ error: "taxRateBps must be a non-negative integer" }, 400);
  }
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
    return json({ error: "reorderLevel must be a non-negative integer" }, 400);
  }

  const orgId = session.organizationId;

  // Check SKU uniqueness
  const existingSku = await prisma.product.findUnique({
    where: {
      organizationId_sku: {
        organizationId: orgId,
        sku,
      },
    },
  });
  if (existingSku) {
    return json({ error: `Product with SKU "${sku}" already exists in this organization` }, 409);
  }

  // Sanitize and check aliases
  const cleanedAliases: string[] = Array.from(
    new Set(
      rawAliases
        .map((a: unknown) => (typeof a === "string" ? a.trim().toLowerCase() : ""))
        .filter((a: string): a is string => Boolean(a)),
    ),
  );

  if (cleanedAliases.length > 0) {
    const conflictingAlias = await prisma.productAlias.findFirst({
      where: {
        organizationId: orgId,
        alias: { in: cleanedAliases },
      },
    });
    if (conflictingAlias) {
      return json(
        { error: `Alias "${conflictingAlias.alias}" is already assigned in this organization` },
        409,
      );
    }
  }

  // Create product with transaction
  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        organizationId: orgId,
        sku,
        name,
        description,
        unit,
        basePriceMinor,
        taxRateBps,
        reorderLevel,
        isActive,
      },
    });

    // Create aliases
    if (cleanedAliases.length > 0) {
      await tx.productAlias.createMany({
        data: cleanedAliases.map((alias) => ({
          organizationId: orgId,
          productId: product.id,
          alias,
        })),
      });
    }

    // Initialize inventory level & movement if specified
    if (initialStock >= 0) {
      await tx.inventoryLevel.create({
        data: {
          organizationId: orgId,
          productId: product.id,
          onHand: initialStock,
          reserved: 0,
        },
      });

      if (initialStock > 0) {
        await tx.stockMovement.create({
          data: {
            organizationId: orgId,
            productId: product.id,
            delta: initialStock,
            reason: "ADJUSTMENT",
            actorId: session.userId,
          },
        });
      }
    }

    return tx.product.findUnique({
      where: { id: product.id },
      include: {
        aliases: { select: { id: true, alias: true } },
        inventoryLevel: { select: { onHand: true, reserved: true } },
      },
    });
  });

  return json({ product: created }, 201);
}
