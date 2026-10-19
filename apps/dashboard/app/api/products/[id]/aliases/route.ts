import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { canWriteCatalog } from "@/app/lib/catalog/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * POST /api/products/[id]/aliases — Adds an alias to a product.
 * Enforces lowercased uniqueness per organization.
 */
export async function POST(
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

  const product = await prisma.product.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!product) {
    return json({ error: "Product not found" }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const rawAlias = typeof body.alias === "string" ? body.alias.trim() : "";
  const cleanAlias = rawAlias.toLowerCase();

  if (!cleanAlias) {
    return json({ error: "Alias cannot be empty" }, 400);
  }

  // Check alias uniqueness across organization
  const existing = await prisma.productAlias.findUnique({
    where: {
      organizationId_alias: {
        organizationId: orgId,
        alias: cleanAlias,
      },
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
    },
  });

  if (existing) {
    return json(
      {
        error: `Alias "${cleanAlias}" already exists and is assigned to SKU "${existing.product.sku}"`,
        code: "ALIAS_ALREADY_EXISTS",
      },
      409,
    );
  }

  const created = await prisma.productAlias.create({
    data: {
      organizationId: orgId,
      productId: id,
      alias: cleanAlias,
    },
  });

  return json({ alias: created }, 201);
}
