import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { canWriteCatalog } from "@/app/lib/catalog/roles";
import type { DiscountScope, DiscountType, Prisma } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * GET /api/products/discount-rules — Lists discount rules for the tenant.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const customerId = searchParams.get("customerId");
  const scope = searchParams.get("scope") as DiscountScope | null;

  const orgId = session.organizationId;
  const where: Prisma.DiscountRuleWhereInput = { organizationId: orgId };
  if (productId) where.productId = productId;
  if (customerId) where.customerId = customerId;
  if (scope) where.scope = scope;

  const rules = await prisma.discountRule.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, company: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
    orderBy: { priority: "desc" },
  });

  return json({ discountRules: rules });
}

/**
 * POST /api/products/discount-rules — Creates a new discount rule.
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

  const scope = body.scope as DiscountScope;
  if (!scope || !["CUSTOMER", "PRODUCT", "ORDER"].includes(scope)) {
    return json({ error: "scope must be one of CUSTOMER, PRODUCT, ORDER" }, 400);
  }

  const type = body.type as DiscountType;
  if (!type || !["PERCENT", "FIXED"].includes(type)) {
    return json({ error: "type must be one of PERCENT, FIXED" }, 400);
  }

  const value = Number(body.value);
  if (!Number.isInteger(value) || value <= 0) {
    return json({ error: "value must be a positive integer" }, 400);
  }

  const customerId = body.customerId ? String(body.customerId).trim() : null;
  const productId = body.productId ? String(body.productId).trim() : null;
  const minQty = body.minQty !== undefined && body.minQty !== null ? Number(body.minQty) : null;
  const minOrderMinor = body.minOrderMinor !== undefined && body.minOrderMinor !== null ? Number(body.minOrderMinor) : null;
  const priority = body.priority !== undefined ? Number(body.priority) : 0;
  const validFrom = typeof body.validFrom === "string" ? new Date(body.validFrom) : null;
  const validTo = typeof body.validTo === "string" ? new Date(body.validTo) : null;

  const orgId = session.organizationId;

  const rule = await prisma.discountRule.create({
    data: {
      organizationId: orgId,
      scope,
      type,
      value,
      customerId,
      productId,
      minQty,
      minOrderMinor,
      priority,
      validFrom,
      validTo,
    },
    include: {
      customer: { select: { id: true, name: true, company: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
  });

  return json({ discountRule: rule }, 201);
}
