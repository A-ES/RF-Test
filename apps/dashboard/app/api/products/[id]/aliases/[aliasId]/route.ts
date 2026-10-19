import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { canWriteCatalog } from "@/app/lib/catalog/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * DELETE /api/products/[id]/aliases/[aliasId] — Removes an alias from a product.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; aliasId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (!canWriteCatalog(session.role)) {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  const { id, aliasId } = await ctx.params;
  const orgId = session.organizationId;

  const existing = await prisma.productAlias.findFirst({
    where: {
      id: aliasId,
      productId: id,
      organizationId: orgId,
    },
  });

  if (!existing) {
    return json({ error: "Alias not found" }, 404);
  }

  await prisma.productAlias.delete({
    where: { id: aliasId },
  });

  return json({ success: true, deletedAliasId: aliasId });
}
