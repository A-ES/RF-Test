/**
 * POST /api/orders/:id/pay — Records payment for an order.
 *
 * NON-NEGOTIABLE RULE 1:
 * Enforces assertOrderApproved(order). Payment can only be recorded for approved orders.
 */
import { getSession } from "@/app/lib/session";
import { recordOrderPayment, OrderOperationError } from "@/app/lib/orders/order-service";
import { OrderApprovalError } from "@/app/lib/orders/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/pay">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const paymentReference =
    typeof body.paymentReference === "string" ? body.paymentReference.trim() : "";

  if (!paymentReference) {
    return json({ error: "paymentReference is required" }, 400);
  }

  try {
    const order = await recordOrderPayment({
      orderId: id,
      organizationId: session.organizationId,
      paymentReference,
      actor: {
        id: session.userId,
        type: "USER",
        role: session.role,
        name: session.name,
      },
    });

    return json({ order, paid: true });
  } catch (err) {
    if (err instanceof OrderApprovalError) {
      return json({ error: err.message, code: err.code }, 412);
    }

    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "PAYMENT_FAILED";
    const status = code === "NOT_FOUND" ? 404 : 400;
    return json({ error: message, code }, status);
  }
}
