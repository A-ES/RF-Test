/**
 * PATCH /api/orders/:id/draft — Edit line items, quantities, SKU pick, price override, delivery fields.
 *
 * Requirements:
 * - Refuses editing an APPROVED order (ORDER_NOT_EDITABLE)
 * - Optimistic concurrency on version (409 on mismatch)
 * - Client-supplied totals are strictly ignored
 * - Server re-prices with priceOrder and recalculates all totals
 * - Re-evaluates stock and updates flags (resolves UNCLEAR_PRODUCT when SKU is picked)
 * - Bumps version on save
 */
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { priceOrder } from "@/app/lib/orders/pricing";
import { loadPricingData } from "@/app/lib/orders/pricing-data";
import { getInventoryProvider } from "@/app/lib/inventory/provider";
import { recordOrderStateChange } from "@/app/lib/orders/order-service";
import type { OrderStatus } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/draft">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // 1. Fetch current order
  const order = await prisma.order.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      lines: true,
      customer: true,
    },
  });

  if (!order) {
    return json({ error: "Order not found" }, 404);
  }

  // 2. Enforce: Editing an APPROVED order is refused
  if (order.status !== "DRAFT" && order.status !== "NEEDS_REVIEW") {
    return json(
      {
        error: `Cannot edit order in status ${order.status}. Editing an approved or confirmed order is strictly refused.`,
        code: "ORDER_NOT_EDITABLE",
      },
      400,
    );
  }

  // 3. Optimistic concurrency check on version
  if (typeof body.version === "number" && order.version !== body.version) {
    return json(
      {
        error: `Order was modified by another user. Expected version ${body.version}, but current version is ${order.version}.`,
        code: "VERSION_CONFLICT",
        currentVersion: order.version,
      },
      409,
    );
  }

  // 4. Resolve delivery fields
  const deliveryAddress =
    body.deliveryAddress !== undefined
      ? typeof body.deliveryAddress === "string"
        ? body.deliveryAddress.trim()
        : null
      : order.deliveryAddress;

  const instructions =
    body.instructions !== undefined
      ? typeof body.instructions === "string"
        ? body.instructions.trim()
        : null
      : order.instructions;

  let deliveryDate: Date | null = order.deliveryDate;
  if (body.deliveryDate !== undefined) {
    if (typeof body.deliveryDate === "string" && body.deliveryDate.trim()) {
      const parsed = new Date(body.deliveryDate);
      if (!isNaN(parsed.getTime())) {
        deliveryDate = parsed;
      }
    } else if (body.deliveryDate === null) {
      deliveryDate = null;
    }
  }

  // 5. Resolve line items
  type RawLineInput = {
    id?: string;
    sku?: string;
    productId?: string;
    qty?: number;
    quantity?: number;
    unitPriceMinor?: number;
    priceOverrideReason?: string;
    rawText?: string;
  };

  const rawLines: RawLineInput[] = Array.isArray(body.lines)
    ? (body.lines as RawLineInput[])
    : order.lines.map((l) => ({
        id: l.id,
        sku: l.sku,
        productId: l.productId ?? undefined,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor,
        rawText: l.rawText,
      }));

  if (rawLines.length === 0) {
    return json({ error: "Order must have at least one line item" }, 400);
  }

  // Find products in organization for validation and SKU lookup
  const skusToLookup = rawLines.map((l) => l.sku?.trim()).filter(Boolean) as string[];
  const productIdsToLookup = rawLines
    .map((l) => l.productId?.trim())
    .filter(Boolean) as string[];

  const matchedProducts = await prisma.product.findMany({
    where: {
      organizationId: session.organizationId,
      OR: [
        ...(skusToLookup.length > 0 ? [{ sku: { in: skusToLookup } }] : []),
        ...(productIdsToLookup.length > 0 ? [{ id: { in: productIdsToLookup } }] : []),
      ],
    },
  });

  const productBySku = new Map(matchedProducts.map((p) => [p.sku.toLowerCase(), p]));
  const productById = new Map(matchedProducts.map((p) => [p.id, p]));

  const inventoryProvider = getInventoryProvider();
  const orderFlags: string[] = [];
  const processedLines: Array<{
    id?: string;
    productId: string | null;
    sku: string;
    rawText: string;
    qty: number;
    unitPriceOverride?: number;
    lineFlags: string[];
    availableQty?: number;
  }> = [];

  for (const item of rawLines) {
    const qty = Math.max(1, Math.round(Number(item.qty ?? item.quantity ?? 1)));
    let prod = item.productId ? productById.get(item.productId) : null;
    if (!prod && item.sku) {
      prod = productBySku.get(item.sku.trim().toLowerCase()) ?? null;
    }

    const sku = prod?.sku ?? item.sku?.trim() ?? "UNKNOWN-SKU";
    const productId = prod?.id ?? null;
    const rawText = item.rawText?.trim() || prod?.name || sku;
    const lineFlags: string[] = [];

    if (!prod) {
      lineFlags.push("UNCLEAR_PRODUCT");
      if (!orderFlags.includes("UNCLEAR_PRODUCT")) {
        orderFlags.push("UNCLEAR_PRODUCT");
      }
    } else {
      // Check stock for this product
      try {
        const stock = await inventoryProvider.getStock(session.organizationId, prod.id);
        if (stock.available <= 0) {
          lineFlags.push("OUT_OF_STOCK");
          if (!orderFlags.includes("OUT_OF_STOCK")) {
            orderFlags.push("OUT_OF_STOCK");
          }
        } else if (stock.available < qty) {
          lineFlags.push(`INSUFFICIENT_STOCK:${stock.available}`);
          if (!orderFlags.includes("INSUFFICIENT_STOCK")) {
            orderFlags.push("INSUFFICIENT_STOCK");
          }
        }
      } catch {}
    }

    processedLines.push({
      id: item.id,
      productId,
      sku,
      rawText,
      qty,
      unitPriceOverride:
        typeof item.unitPriceMinor === "number" && item.unitPriceMinor >= 0
          ? Math.round(item.unitPriceMinor)
          : undefined,
      lineFlags,
    });
  }

  // 6. Pricing via pure priceOrder function (client-supplied totals are strictly ignored)
  const validProductIds = processedLines
    .map((l) => l.productId)
    .filter((id): id is string => Boolean(id));

  const pricingData = await loadPricingData({
    organizationId: session.organizationId,
    customerId: order.customerId,
    productIds: validProductIds,
  });

  const pricingInput = processedLines.map((l) => {
    const prod = l.productId ? productById.get(l.productId) : null;
    return {
      productId: l.productId || "unknown",
      sku: l.sku,
      qty: l.qty,
      unitPriceOverrideMinor: l.unitPriceOverride,
      basePriceMinor: prod?.basePriceMinor ?? 0,
      taxRateBps: prod?.taxRateBps ?? 1800,
    };
  });

  const priced = priceOrder({
    lines: pricingInput,
    customer: order.customerId
      ? {
          id: order.customerId,
          customerPrices: pricingData.customerPrices.map((cp) => ({
            productId: cp.productId,
            priceMinor: cp.priceMinor,
            validFrom: cp.validFrom,
            validTo: cp.validTo,
          })),
        }
      : null,
    rules: pricingData.discountRules.map((dr) => ({
      id: dr.id,
      scope: dr.scope,
      customerId: dr.customerId,
      productId: dr.productId,
      type: dr.type,
      value: dr.value,
      minQty: dr.minQty,
      minOrderMinor: dr.minOrderMinor,
      validFrom: dr.validFrom,
      validTo: dr.validTo,
      priority: dr.priority,
    })),
    taxConfig: { defaultTaxRateBps: 1800 },
    now: new Date(),
  });

  // Combine order-level flags
  if (!deliveryDate && !orderFlags.includes("MISSING_DELIVERY_DATE")) {
    orderFlags.push("MISSING_DELIVERY_DATE");
  }
  if (!deliveryAddress && !orderFlags.includes("MISSING_ADDRESS")) {
    orderFlags.push("MISSING_ADDRESS");
  }
  for (const flag of priced.flags) {
    if (!orderFlags.includes(flag)) {
      orderFlags.push(flag);
    }
  }

  const blockingFlagsList = [
    "INSUFFICIENT_STOCK",
    "OUT_OF_STOCK",
    "UNCLEAR_PRODUCT",
    "NO_PRICE",
    "MISSING_DELIVERY_DATE",
    "MISSING_ADDRESS",
  ];
  const hasBlockingFlags = orderFlags.some((f) =>
    blockingFlagsList.some((bf) => f === bf || f.startsWith(`${bf}:`)),
  );
  const newStatus: OrderStatus = hasBlockingFlags ? "NEEDS_REVIEW" : "DRAFT";

  // 7. Atomic transaction update
  const updatedOrder = await prisma.$transaction(async (tx) => {
    // Delete existing lines and re-create fresh lines
    await tx.orderLine.deleteMany({
      where: { orderId: order.id },
    });

    await Promise.all(
      processedLines.map((pl, idx) => {
        const pLine = priced.lines[idx];
        return tx.orderLine.create({
          data: {
            organizationId: session.organizationId,
            orderId: order.id,
            productId: pl.productId,
            sku: pl.sku,
            rawText: pl.rawText,
            matchConfidence: pl.productId ? 1.0 : 0.5,
            qty: pl.qty,
            unitPriceMinor: pLine?.unitPriceMinor ?? pl.unitPriceOverride ?? 0,
            discountMinor: pLine?.discountMinor ?? 0,
            taxMinor: pLine?.taxMinor ?? 0,
            lineTotalMinor: pLine?.totalMinor ?? 0,
            flagsJson: JSON.stringify(pl.lineFlags),
          },
        });
      }),
    );

    const saved = await tx.order.update({
      where: { id: order.id },
      data: {
        status: newStatus,
        subtotalMinor: priced.subtotalMinor,
        discountMinor: priced.discountMinor,
        taxMinor: priced.taxMinor,
        totalMinor: priced.totalMinor,
        deliveryDate,
        deliveryAddress,
        instructions,
        flagsJson: JSON.stringify(orderFlags),
        version: { increment: 1 },
      },
      include: {
        lines: {
          include: {
            product: {
              include: {
                inventoryLevel: true,
              },
            },
          },
        },
        customer: true,
        events: { orderBy: { createdAt: "asc" } },
      },
    });

    return saved;
  });

  // 8. Record audit log & OrderEvent
  await recordOrderStateChange({
    orderId: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    draftNumber: updatedOrder.draftNumber,
    organizationId: session.organizationId,
    actor: {
      id: session.userId,
      type: "USER",
      role: session.role,
      name: session.name,
    },
    eventType: "DRAFT_EDITED",
    fromStatus: order.status,
    toStatus: newStatus,
    payload: {
      version: updatedOrder.version,
      subtotalMinor: updatedOrder.subtotalMinor,
      taxMinor: updatedOrder.taxMinor,
      totalMinor: updatedOrder.totalMinor,
      flags: orderFlags,
    },
  });

  return json({ order: updatedOrder });
}
