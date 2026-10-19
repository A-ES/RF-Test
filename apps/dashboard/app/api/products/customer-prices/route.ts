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
 * GET /api/products/customer-prices — Lists customer-specific contracted prices.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const customerId = searchParams.get("customerId");

  const orgId = session.organizationId;
  const where: Prisma.CustomerPriceWhereInput = { organizationId: orgId };
  if (productId) where.productId = productId;
  if (customerId) where.customerId = customerId;

  const prices = await prisma.customerPrice.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, company: true } },
      product: { select: { id: true, sku: true, name: true, basePriceMinor: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return json({ customerPrices: prices });
}

/**
 * POST /api/products/customer-prices — Creates or updates a customer contracted price.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (!canWriteCatalog(session.role)) {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  const productId = typeof body.productId === "string" ? body.productId.trim() : "";
  const priceMinor = Number(body.priceMinor);
  const validFrom = typeof body.validFrom === "string" ? new Date(body.validFrom) : null;
  const validTo = typeof body.validTo === "string" ? new Date(body.validTo) : null;

  if (!customerId) return json({ error: "customerId is required" }, 400);
  if (!productId) return json({ error: "productId is required" }, 400);
  if (!Number.isInteger(priceMinor) || priceMinor < 0) {
    return json({ error: "priceMinor must be a non-negative integer (paise)" }, 400);
  }

  const orgId = session.organizationId;

  // Verify product and customer belong to tenant
  const [product, customer] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, organizationId: orgId } }),
    prisma.customer.findFirst({ where: { id: customerId, organizationId: orgId } }),
  ]);

  if (!product) return json({ error: "Product not found" }, 404);
  if (!customer) return json({ error: "Customer not found" }, 404);

  const price = await prisma.customerPrice.upsert({
    where: {
      organizationId_customerId_productId: {
        organizationId: orgId,
        customerId,
        productId,
      },
    },
    update: {
      priceMinor,
      validFrom,
      validTo,
    },
    create: {
      organizationId: orgId,
      customerId,
      productId,
      priceMinor,
      validFrom,
      validTo,
    },
    include: {
      customer: { select: { id: true, name: true, company: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
  });

  return json({ customerPrice: price }, 200);
}
