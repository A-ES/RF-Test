import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { deliverCustomerUpdate } from "@/app/lib/messaging/customer-updates";
import { assertOrderApproved } from "@/app/lib/orders/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/orders/[id]/payments/resend-link">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const order = await prisma.order.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      invoices: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) return json({ error: "Order not found" }, 404);
  assertOrderApproved(order);

  const invoice = order.invoices[0];
  const paymentLink = invoice?.paymentLinkUrl;

  // Trigger customer update with bumped version so dedupe allows explicit resend
  await deliverCustomerUpdate({
    orderId: order.id,
    organizationId: session.organizationId,
    event: "INVOICE_SENT",
    version: order.version + Date.now(),
    extraData: {
      invoiceNumber: invoice?.invoiceNumber ?? "N/A",
      paymentLink,
    },
  });

  return json({ success: true, paymentLink, resent: true });
}
