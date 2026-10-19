import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/customers/[id]/orders">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const customer = await prisma.customer.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });

  if (!customer) return json({ error: "Customer not found" }, 404);

  const orders = await prisma.order.findMany({
    where: {
      customerId: id,
      organizationId: session.organizationId,
    },
    include: {
      lines: {
        select: {
          id: true,
          sku: true,
          qty: true,
          rawText: true,
          unitPriceMinor: true,
          lineTotalMinor: true,
        },
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalMinor: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return json({ orders });
}
