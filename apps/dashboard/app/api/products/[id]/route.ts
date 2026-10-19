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
 * GET /api/products/[id] — Retrieves full product detail.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;
  const orgId = session.organizationId;

  const product = await prisma.product.findFirst({
    where: { id, organizationId: orgId },
    include: {
      aliases: {
        select: { id: true, alias: true, createdAt: true },
        orderBy: { alias: "asc" },
      },
      inventoryLevel: {
        select: { onHand: true, reserved: true, updatedAt: true },
      },
      customerPrices: {
        include: {
          customer: { select: { id: true, name: true, company: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      discountRules: {
        include: {
          customer: { select: { id: true, name: true, company: true } },
        },
        orderBy: { priority: "desc" },
      },
      stockMovements: {
        take: 20,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!product) {
    return json({ error: "Product not found" }, 404);
  }

  const onHand = product.inventoryLevel?.onHand ?? 0;
  const reserved = product.inventoryLevel?.reserved ?? 0;
  const available = onHand - reserved;

  return json({
    product: {
      ...product,
      stock: {
        onHand,
        reserved,
        available,
        isReorderNeeded: available <= product.reorderLevel,
      },
    },
  });
}

/**
 * PATCH /api/products/[id] — Updates product attributes (CLIENT_ADMIN or ADMIN only).
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (!canWriteCatalog(session.role)) {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  const { id } = await ctx.params;
  const orgId = session.organizationId;

  const existing = await prisma.product.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) {
    return json({ error: "Product not found" }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const data: Prisma.ProductUpdateInput = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return json({ error: "Name cannot be empty" }, 400);
    data.name = name;
  }
  if (body.description !== undefined) {
    data.description = body.description ? String(body.description).trim() : null;
  }
  if (body.unit !== undefined) {
    const unit = String(body.unit).trim();
    if (!unit) return json({ error: "Unit cannot be empty" }, 400);
    data.unit = unit;
  }
  if (body.basePriceMinor !== undefined) {
    const price = Number(body.basePriceMinor);
    if (!Number.isInteger(price) || price < 0) {
      return json({ error: "basePriceMinor must be a non-negative integer (paise)" }, 400);
    }
    data.basePriceMinor = price;
  }
  if (body.taxRateBps !== undefined) {
    const tax = Number(body.taxRateBps);
    if (!Number.isInteger(tax) || tax < 0) {
      return json({ error: "taxRateBps must be a non-negative integer" }, 400);
    }
    data.taxRateBps = tax;
  }
  if (body.reorderLevel !== undefined) {
    const reorder = Number(body.reorderLevel);
    if (!Number.isInteger(reorder) || reorder < 0) {
      return json({ error: "reorderLevel must be a non-negative integer" }, 400);
    }
    data.reorderLevel = reorder;
  }
  if (body.isActive !== undefined) {
    data.isActive = Boolean(body.isActive);
  }

  const updated = await prisma.product.update({
    where: { id },
    data,
    include: {
      aliases: { select: { id: true, alias: true } },
      inventoryLevel: { select: { onHand: true, reserved: true } },
    },
  });

  return json({ product: updated });
}

/**
 * DELETE /api/products/[id] — Deactivates product (CLIENT_ADMIN or ADMIN only).
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (!canWriteCatalog(session.role)) {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  const { id } = await ctx.params;
  const orgId = session.organizationId;

  const existing = await prisma.product.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) {
    return json({ error: "Product not found" }, 404);
  }

  // Deactivate product
  const deactivated = await prisma.product.update({
    where: { id },
    data: { isActive: false },
  });

  return json({ product: deactivated, deactivated: true });
}
