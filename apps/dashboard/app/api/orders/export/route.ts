import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const orders = await prisma.order.findMany({
    where: { organizationId: session.organizationId },
    include: {
      customer: { select: { name: true, company: true, phone: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const headers = [
    "Order ID",
    "Order Number",
    "Draft Number",
    "Customer Name",
    "Company",
    "Customer Phone",
    "Customer Email",
    "Status",
    "Payment Status",
    "Subtotal (INR)",
    "Tax (INR)",
    "Total (INR)",
    "Delivery Date",
    "Delivery Address",
    "Created At",
  ];

  const rows = orders.map((o) => [
    escapeCsv(o.id),
    escapeCsv(o.orderNumber || ""),
    escapeCsv(o.draftNumber),
    escapeCsv(o.customer?.name || ""),
    escapeCsv(o.customer?.company || ""),
    escapeCsv(o.customer?.phone || ""),
    escapeCsv(o.customer?.email || ""),
    escapeCsv(o.status),
    escapeCsv(o.paymentStatus),
    escapeCsv(((o.subtotalMinor || 0) / 100).toFixed(2)),
    escapeCsv(((o.taxMinor || 0) / 100).toFixed(2)),
    escapeCsv(((o.totalMinor || 0) / 100).toFixed(2)),
    escapeCsv(o.deliveryDate ? o.deliveryDate.toISOString() : ""),
    escapeCsv(o.deliveryAddress || ""),
    escapeCsv(o.createdAt.toISOString()),
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
