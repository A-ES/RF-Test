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

  const payments = await prisma.payment.findMany({
    where: { organizationId: session.organizationId },
    include: {
      order: {
        select: {
          orderNumber: true,
          draftNumber: true,
          customer: { select: { name: true, company: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const headers = [
    "Payment ID",
    "Order ID",
    "Order Number",
    "Customer Name",
    "Company",
    "Provider",
    "Provider Payment ID",
    "Amount (INR)",
    "Status",
    "Paid At",
    "Created At",
  ];

  const rows = payments.map((p) => [
    escapeCsv(p.id),
    escapeCsv(p.orderId),
    escapeCsv(p.order?.orderNumber || p.order?.draftNumber || ""),
    escapeCsv(p.order?.customer?.name || ""),
    escapeCsv(p.order?.customer?.company || ""),
    escapeCsv(p.provider),
    escapeCsv(p.providerPaymentId),
    escapeCsv(((p.amountMinor || 0) / 100).toFixed(2)),
    escapeCsv(p.status),
    escapeCsv(p.paidAt ? p.paidAt.toISOString() : ""),
    escapeCsv(p.createdAt.toISOString()),
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payments-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
