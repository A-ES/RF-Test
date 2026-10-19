import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { canWriteCatalog } from "@/app/lib/catalog/roles";
import { getInventoryProvider, ZeroFloorViolationError } from "@/app/lib/inventory/provider";
import type { Prisma, StockMovementReason } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * GET /api/inventory/adjustments — Lists stock movement audit records for the tenant.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  const orgId = session.organizationId;
  const where: Prisma.StockMovementWhereInput = { organizationId: orgId };
  if (productId) where.productId = productId;

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
        order: { select: { id: true, orderNumber: true, draftNumber: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return json({ movements, total, limit, offset });
}

/**
 * POST /api/inventory/adjustments — Atomically adjusts inventory and records stock movement.
 * Enforces zero-floor rule unless the organization enables backorders.
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

  const productId = typeof body.productId === "string" ? body.productId.trim() : "";
  const delta = Number(body.delta);
  const reason = (body.reason as StockMovementReason) || "ADJUSTMENT";
  const notes = body.notes ? String(body.notes).trim() : undefined;

  if (!productId) {
    return json({ error: "productId is required" }, 400);
  }
  if (!Number.isInteger(delta) || delta === 0) {
    return json({ error: "delta must be a non-zero integer" }, 400);
  }

  const validReasons: StockMovementReason[] = [
    "ADJUSTMENT",
    "ORDER_RESERVE",
    "ORDER_RELEASE",
    "FULFILLMENT",
    "ERP_SYNC",
  ];
  if (!validReasons.includes(reason)) {
    return json(
      { error: `reason must be one of: ${validReasons.join(", ")}` },
      400,
    );
  }

  const orgId = session.organizationId;

  // Verify product exists in tenant
  const product = await prisma.product.findFirst({
    where: { id: productId, organizationId: orgId },
  });
  if (!product) {
    return json({ error: "Product not found" }, 404);
  }

  try {
    const provider = getInventoryProvider();
    const stockInfo = await provider.adjust(orgId, productId, delta, {
      reason,
      actorId: session.userId,
      notes,
    });

    return json({
      success: true,
      productId,
      sku: product.sku,
      delta,
      reason,
      stock: stockInfo,
    });
  } catch (err) {
    if (err instanceof ZeroFloorViolationError) {
      return json(
        {
          error: err.message,
          code: err.code,
        },
        400,
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
