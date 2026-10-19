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
  const daysParam = url.searchParams.get("days");
  const days = daysParam ? Math.max(1, parseInt(daysParam, 10) || 30) : 30;

  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const orgId = session.organizationId;

  // 1. Orders in scope
  const orders = await prisma.order.findMany({
    where: {
      organizationId: orgId,
      createdAt: { gte: startDate },
    },
    include: {
      customer: { select: { id: true, name: true, company: true } },
      lines: true,
      invoices: true,
      fulfillments: true,
      payments: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Calculate Cards:
  const newOrders = orders.filter((o) => o.status === "DRAFT" || o.status === "NEEDS_REVIEW");
  const awaitingApproval = orders.filter((o) => o.status === "NEEDS_REVIEW");

  // Oldest age for awaiting approval
  let oldestAgeFormatted = "0m";
  if (awaitingApproval.length > 0) {
    const oldest = awaitingApproval.reduce((min, o) => (o.createdAt < min.createdAt ? o : min), awaitingApproval[0]);
    const ageMs = now.getTime() - oldest.createdAt.getTime();
    const ageHrs = ageMs / (1000 * 60 * 60);
    if (ageHrs < 1) {
      oldestAgeFormatted = `${Math.round(ageMs / (1000 * 60))}m`;
    } else if (ageHrs < 24) {
      oldestAgeFormatted = `${ageHrs.toFixed(1)}h`;
    } else {
      oldestAgeFormatted = `${(ageHrs / 24).toFixed(1)}d`;
    }
  }

  const approvedOrders = orders.filter((o) =>
    ["APPROVED", "FULFILLING", "DISPATCHED", "DELIVERED"].includes(o.status),
  );
  const rejectedOrders = orders.filter((o) => o.status === "REJECTED" || o.status === "CANCELLED");

  // Fulfillment counts
  const allFulfillments = await prisma.fulfillment.findMany({
    where: { organizationId: orgId },
  });
  const fulfillmentCounts = {
    pending: allFulfillments.filter((f) => f.status === "PENDING").length,
    packing: allFulfillments.filter((f) => f.status === "PACKING").length,
    dispatched: allFulfillments.filter((f) => f.status === "DISPATCHED").length,
    delivered: allFulfillments.filter((f) => f.status === "DELIVERED").length,
  };

  // Payments breakdown
  const paidAmountMinor = orders
    .filter((o) => o.paymentStatus === "PAID")
    .reduce((sum, o) => sum + (o.totalMinor || 0), 0);

  const partialAmountMinor = orders
    .filter((o) => o.paymentStatus === "PARTIAL")
    .reduce((sum, o) => sum + (o.totalMinor || 0), 0);

  const unpaidAmountMinor = orders
    .filter((o) => o.paymentStatus === "UNPAID")
    .reduce((sum, o) => sum + (o.totalMinor || 0), 0);

  // Overdue Invoices
  const allInvoices = await prisma.invoice.findMany({
    where: { organizationId: orgId },
    include: {
      order: {
        include: { customer: { select: { name: true, company: true } } },
      },
    },
  });

  const overdueInvoicesList = allInvoices.filter(
    (inv) => inv.dueAt && inv.dueAt < now && inv.status !== "PAID" && inv.status !== "VOID",
  );

  const overdueAmountMinor = overdueInvoicesList.reduce((sum, inv) => sum + (inv.totalMinor || 0), 0);

  // Revenue & Average Order Value (AOV)
  const totalRevenueMinor = approvedOrders.reduce((sum, o) => sum + (o.totalMinor || 0), 0);
  const aovMinor = approvedOrders.length > 0 ? Math.round(totalRevenueMinor / approvedOrders.length) : 0;

  // Inventory Table & Low Stock count
  const inventoryLevels = await prisma.inventoryLevel.findMany({
    where: { organizationId: orgId },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          reorderLevel: true,
          unit: true,
        },
      },
    },
  });

  let lowStockCount = 0;
  const inventoryTable = inventoryLevels.map((lvl) => {
    const available = lvl.onHand - lvl.reserved;
    const reorderLevel = lvl.product?.reorderLevel ?? 0;
    const isLowStock = available <= reorderLevel;
    if (isLowStock) lowStockCount++;

    return {
      sku: lvl.product?.sku || "UNKNOWN",
      name: lvl.product?.name || "Product",
      unit: lvl.product?.unit || "unit",
      onHand: lvl.onHand,
      reserved: lvl.reserved,
      available,
      reorderLevel,
      isLowStock,
    };
  });

  // Daily Chart Data: Revenue & Orders per day
  const dayMap = new Map<string, { date: string; revenueMinor: number; orderCount: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    dayMap.set(dateStr, { date: dateStr, revenueMinor: 0, orderCount: 0 });
  }

  for (const o of orders) {
    const dStr = o.createdAt.toISOString().slice(0, 10);
    if (dayMap.has(dStr)) {
      const entry = dayMap.get(dStr)!;
      entry.orderCount += 1;
      if (["APPROVED", "FULFILLING", "DISPATCHED", "DELIVERED"].includes(o.status)) {
        entry.revenueMinor += o.totalMinor || 0;
      }
    }
  }

  const revenueAndOrdersPerDay = Array.from(dayMap.values());

  // Funnel: drafted -> approved -> invoiced -> paid -> delivered
  const funnel = {
    drafted: orders.length,
    approved: approvedOrders.length,
    invoiced: orders.filter((o) => o.invoices && o.invoices.length > 0).length,
    paid: orders.filter((o) => o.paymentStatus === "PAID").length,
    delivered: orders.filter((o) => o.status === "DELIVERED").length,
  };

  // Top Products
  const prodMap = new Map<string, { sku: string; name: string; quantity: number; revenueMinor: number }>();
  for (const o of approvedOrders) {
    for (const l of o.lines) {
      if (!l.sku) continue;
      const key = l.sku;
      const existing = prodMap.get(key) || {
        sku: l.sku,
        name: l.rawText || l.sku,
        quantity: 0,
        revenueMinor: 0,
      };
      existing.quantity += l.qty;
      existing.revenueMinor += l.lineTotalMinor || 0;
      prodMap.set(key, existing);
    }
  }
  const topProducts = Array.from(prodMap.values())
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
    .slice(0, 5);

  // Top Customers
  const custMap = new Map<string, { id: string; name: string; company?: string | null; orderCount: number; totalSpendMinor: number }>();
  for (const o of approvedOrders) {
    if (!o.customer) continue;
    const cid = o.customer.id;
    const existing = custMap.get(cid) || {
      id: cid,
      name: o.customer.name,
      company: o.customer.company,
      orderCount: 0,
      totalSpendMinor: 0,
    };
    existing.orderCount += 1;
    existing.totalSpendMinor += o.totalMinor || 0;
    custMap.set(cid, existing);
  }
  const topCustomers = Array.from(custMap.values())
    .sort((a, b) => b.totalSpendMinor - a.totalSpendMinor)
    .slice(0, 5);

  // Recent Orders (latest 10)
  const recentOrders = orders.slice(0, 10).map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber || o.draftNumber,
    customerName: o.customer?.name || "Customer",
    company: o.customer?.company,
    totalMinor: o.totalMinor,
    status: o.status,
    paymentStatus: o.paymentStatus,
    createdAt: o.createdAt.toISOString(),
  }));

  // Overdue Invoices Table
  const overdueInvoices = overdueInvoicesList.slice(0, 10).map((inv) => {
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - inv.dueAt!.getTime()) / (1000 * 60 * 60 * 24)));
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      orderId: inv.orderId,
      orderNumber: inv.order?.orderNumber || inv.order?.draftNumber || "Order",
      customerName: inv.order?.customer?.name || "Customer",
      totalMinor: inv.totalMinor,
      dueAt: inv.dueAt!.toISOString(),
      daysOverdue,
    };
  });

  return json({
    cards: {
      newOrdersCount: newOrders.length,
      awaitingApprovalCount: awaitingApproval.length,
      awaitingApprovalOldestAge: oldestAgeFormatted,
      approvedCount: approvedOrders.length,
      rejectedCount: rejectedOrders.length,
      fulfillmentCounts,
      payments: {
        paidMinor: paidAmountMinor,
        partialMinor: partialAmountMinor,
        unpaidMinor: unpaidAmountMinor,
        overdueMinor: overdueAmountMinor,
      },
      revenueMinor: totalRevenueMinor,
      aovMinor,
      lowStockCount,
    },
    charts: {
      revenueAndOrdersPerDay,
      funnel,
      topProducts,
      topCustomers,
    },
    tables: {
      inventory: inventoryTable.slice(0, 10),
      recentOrders,
      overdueInvoices,
    },
    days,
  });
}
