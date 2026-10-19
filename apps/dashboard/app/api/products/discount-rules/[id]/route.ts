import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { canWriteCatalog } from "@/app/lib/catalog/roles";
import type { Prisma } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * PATCH /api/products/discount-rules/[id] — Updates a discount rule.
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

  const existing = await prisma.discountRule.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) {
    return json({ error: "Discount rule not found" }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const data: Prisma.DiscountRuleUpdateInput = {};
  if (body.value !== undefined) {
    const val = Number(body.value);
    if (!Number.isInteger(val) || val <= 0) {
      return json({ error: "value must be a positive integer" }, 400);
    }
    data.value = val;
  }
  if (body.minQty !== undefined) {
    data.minQty = body.minQty !== null ? Number(body.minQty) : null;
  }
  if (body.minOrderMinor !== undefined) {
    data.minOrderMinor = body.minOrderMinor !== null ? Number(body.minOrderMinor) : null;
  }
  if (body.priority !== undefined) {
    data.priority = Number(body.priority);
  }
  if (body.validFrom !== undefined) {
    data.validFrom = typeof body.validFrom === "string" ? new Date(body.validFrom) : null;
  }
  if (body.validTo !== undefined) {
    data.validTo = typeof body.validTo === "string" ? new Date(body.validTo) : null;
  }

  const updated = await prisma.discountRule.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, name: true, company: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
  });

  return json({ discountRule: updated });
}

/**
 * DELETE /api/products/discount-rules/[id] — Deletes a discount rule.
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

  const existing = await prisma.discountRule.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) {
    return json({ error: "Discount rule not found" }, 404);
  }

  await prisma.discountRule.delete({
    where: { id },
  });

  return json({ success: true, deletedId: id });
}
