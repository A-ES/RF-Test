/**
 * GET /api/admin/plans
 * Returns all active billing plans available to assign to organizations.
 */
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const plans = await prisma.plan.findMany({
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      priceCents: true,
      currency: true,
      interval: true,
      seatLimit: true,
      customerLimit: true,
      featuresJson: true,
      isActive: true,
    },
  });

  return Response.json({ plans });
}
