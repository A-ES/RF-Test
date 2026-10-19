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
  const search = url.searchParams.get("search")?.trim() ?? "";

  const customers = await prisma.customer.findMany({
    where: {
      organizationId: session.organizationId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { company: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { whatsapp: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      orders: {
        select: {
          id: true,
          totalMinor: true,
          status: true,
          createdAt: true,
        },
      },
      conversations: {
        select: {
          id: true,
          status: true,
          lastMessageAt: true,
        },
        take: 1,
        orderBy: { lastMessageAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const formatted = customers.map((c) => {
    const totalSpendMinor = c.orders.reduce((sum, o) => sum + (o.totalMinor || 0), 0);
    return {
      id: c.id,
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      whatsapp: c.whatsapp,
      status: c.status,
      taxId: c.taxId,
      paymentTermsDays: c.paymentTermsDays,
      createdAt: c.createdAt.toISOString(),
      orderCount: c.orders.length,
      totalSpendMinor,
      lastOrderAt: c.orders[0]?.createdAt?.toISOString() ?? null,
      lastConversationAt: c.conversations[0]?.lastMessageAt?.toISOString() ?? null,
    };
  });

  return json({ customers: formatted });
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.name?.trim()) {
    return json({ error: "Customer name is required" }, 400);
  }

  const customer = await prisma.customer.create({
    data: {
      organizationId: session.organizationId,
      name: body.name.trim(),
      company: body.company?.trim() ?? null,
      email: body.email?.trim() ?? null,
      phone: body.phone?.trim() ?? null,
      whatsapp: body.whatsapp?.trim() ?? null,
      taxId: body.taxId?.trim() ?? null,
      paymentTermsDays: body.paymentTermsDays ? Number(body.paymentTermsDays) : null,
      tagsJson: JSON.stringify(body.tags ?? []),
      internalNotes: body.internalNotes?.trim() ?? null,
    },
  });

  return json({ customer }, 201);
}
