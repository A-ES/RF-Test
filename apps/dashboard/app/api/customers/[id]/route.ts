import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/customers/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const customer = await prisma.customer.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 10,
      },
      customerPrices: {
        include: { product: true },
      },
    },
  });

  if (!customer) return json({ error: "Customer not found" }, 404);

  const totalSpendMinor = customer.orders.reduce((sum, o) => sum + (o.totalMinor || 0), 0);

  return json({
    customer: {
      ...customer,
      totalSpendMinor,
      orderCount: customer.orders.length,
    },
  });
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/customers/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const existing = await prisma.customer.findFirst({
    where: { id, organizationId: session.organizationId },
  });
  if (!existing) return json({ error: "Customer not found" }, 404);

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      name: body.name !== undefined ? body.name.trim() : undefined,
      company: body.company !== undefined ? body.company?.trim() : undefined,
      email: body.email !== undefined ? body.email?.trim() : undefined,
      phone: body.phone !== undefined ? body.phone?.trim() : undefined,
      whatsapp: body.whatsapp !== undefined ? body.whatsapp?.trim() : undefined,
      taxId: body.taxId !== undefined ? body.taxId?.trim() : undefined,
      paymentTermsDays: body.paymentTermsDays !== undefined ? (body.paymentTermsDays ? Number(body.paymentTermsDays) : null) : undefined,
      status: body.status !== undefined ? body.status : undefined,
      internalNotes: body.internalNotes !== undefined ? body.internalNotes : undefined,
    },
  });

  return json({ customer: updated });
}
