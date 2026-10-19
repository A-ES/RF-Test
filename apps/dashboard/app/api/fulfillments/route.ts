import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");

  const whereClause: Record<string, unknown> = {
    organizationId: session.organizationId,
  };
  if (statusFilter && ["PENDING", "PACKING", "DISPATCHED", "DELIVERED"].includes(statusFilter)) {
    whereClause.status = statusFilter;
  }

  const fulfillments = await prisma.fulfillment.findMany({
    where: whereClause,
    include: {
      order: {
        include: {
          customer: true,
          lines: {
            include: { product: true },
          },
          invoices: {
            where: { status: { not: "VOID" } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          payments: {
            where: { status: "SUCCESS" },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return json({ fulfillments });
}
