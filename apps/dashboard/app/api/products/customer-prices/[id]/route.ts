import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { canWriteCatalog } from "@/app/lib/catalog/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * DELETE /api/products/customer-prices/[id] — Deletes a contracted customer price.
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

  const existing = await prisma.customerPrice.findFirst({
    where: { id, organizationId: orgId },
  });

  if (!existing) {
    return json({ error: "Customer price record not found" }, 404);
  }

  await prisma.customerPrice.delete({
    where: { id },
  });

  return json({ success: true, deletedId: id });
}
