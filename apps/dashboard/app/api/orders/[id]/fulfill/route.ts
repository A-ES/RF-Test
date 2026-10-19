/**
 * POST /api/orders/:id/fulfill — Fulfills an order and commits inventory deduction.
 *
 * NON-NEGOTIABLE RULE 1:
 * Enforces assertOrderApproved(order). Will reject and throw OrderApprovalError
 * if the order has not been approved by an administrator.
 */
import { getSession } from "@/app/lib/session";
import { fulfillOrder, OrderOperationError } from "@/app/lib/orders/order-service";
import { OrderApprovalError } from "@/app/lib/orders/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/orders/[id]/fulfill">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  try {
    const order = await fulfillOrder({
      orderId: id,
      organizationId: session.organizationId,
      actor: {
        id: session.userId,
        role: session.role,
        type: "USER",
      },
    });

    return json({ order, fulfilled: true });
  } catch (err) {
    if (err instanceof OrderApprovalError) {
      return json(
        {
          error: err.message,
          code: err.code,
        },
        412, // Precondition Failed
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "FULFILLMENT_FAILED";
    const status = code === "NOT_FOUND" ? 404 : 400;
    return json({ error: message, code }, status);
  }
}
