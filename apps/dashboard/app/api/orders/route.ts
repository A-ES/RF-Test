/**
 * GET  /api/orders — List orders for authenticated organization with filters and cursor pagination
 * POST /api/orders — Create a new order (DRAFT or NEEDS_REVIEW)
 */
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { createOrder, OrderOperationError } from "@/app/lib/orders/order-service";
import type { OrderStatus, Prisma } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status")?.toUpperCase();
  const tabParam = url.searchParams.get("tab")?.toLowerCase();
  const customerIdParam = url.searchParams.get("customerId")?.trim();
  const search = url.searchParams.get("search")?.trim() ?? "";
  const cursor = url.searchParams.get("cursor")?.trim();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));

  // Status mapping based on tab filter
  let statusFilter: Prisma.EnumOrderStatusFilter | OrderStatus | undefined;
  if (statusParam) {
    statusFilter = statusParam as OrderStatus;
  } else if (tabParam === "new") {
    statusFilter = "DRAFT";
  } else if (tabParam === "awaiting_approval" || tabParam === "needs_review") {
    statusFilter = "NEEDS_REVIEW";
  } else if (tabParam === "approved") {
    statusFilter = {
      in: ["APPROVED", "FULFILLING", "DISPATCHED", "DELIVERED"],
    };
  } else if (tabParam === "rejected") {
    statusFilter = {
      in: ["REJECTED", "CANCELLED"],
    };
  }

  const whereClause: Prisma.OrderWhereInput = {
    organizationId: session.organizationId,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(customerIdParam ? { customerId: customerIdParam } : {}),
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: "insensitive" } },
            { draftNumber: { contains: search, mode: "insensitive" } },
            { customer: { name: { contains: search, mode: "insensitive" } } },
            { customer: { company: { contains: search, mode: "insensitive" } } },
            { customer: { phone: { contains: search, mode: "insensitive" } } },
            { customer: { whatsapp: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [ordersWithExcess, totalCount] = await Promise.all([
    prisma.order.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            company: true,
            whatsapp: true,
            phone: true,
            email: true,
            status: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
              },
            },
          },
        },
      },
    }),
    typeof prisma.order.count === "function"
      ? prisma.order.count({ where: whereClause })
      : Promise.resolve(0),
  ]);

  let nextCursor: string | null = null;
  const orders = [...ordersWithExcess];
  if (orders.length > limit) {
    const nextItem = orders.pop();
    if (nextItem) {
      nextCursor = nextItem.id;
    }
  }

  return json({
    orders,
    nextCursor,
    totalCount,
  });
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : null;
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!customerId) {
    return json({ error: "customerId is required" }, 400);
  }
  if (rawItems.length === 0) {
    return json({ error: "items array with at least one line item is required" }, 400);
  }

  try {
    const formattedItems = rawItems.map((item: Record<string, unknown>) => {
      const sku = item.sku ? String(item.sku) : "";
      const name = item.name ? String(item.name) : sku;
      if (!sku) {
        throw new Error("Line items require a sku");
      }
      const qty = Number(item.quantity);
      const price = Number(item.unitPricePaise);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error("Line item quantity must be a positive integer");
      }
      if (!Number.isInteger(price) || price < 0) {
        throw new Error("Line item unitPricePaise must be a non-negative integer (paise)");
      }
      return {
        productId: item.productId ? String(item.productId) : null,
        inventoryItemId: item.inventoryItemId ? String(item.inventoryItemId) : null,
        sku,
        name,
        rawText: item.rawText ? String(item.rawText) : name,
        quantity: qty,
        unitPricePaise: price,
      };
    });

    const order = await createOrder({
      organizationId: session.organizationId,
      customerId,
      conversationId,
      items: formattedItems,
      currency: typeof body.currency === "string" ? body.currency : "INR",
      instructions: typeof body.instructions === "string" ? body.instructions : typeof body.notes === "string" ? body.notes : null,
      status: body.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "DRAFT",
      actor: {
        id: session.userId,
        type: "USER",
        role: session.role,
        name: session.name,
      },
    });

    return json({ order }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "INVALID_INPUT";
    return json({ error: message, code }, 400);
  }
}
