/**
 * POST /api/orders/:id/reject — Rejects an order with a mandatory reason.
 *
 * Requirements:
 * - Role: CLIENT_ADMIN or ADMIN only
 * - reason: required
 * - optional customer message: sent only if explicitly confirmed
 * - releases reservations if any were held; releases nothing if order was never reserved
 */
import { getSession } from "@/app/lib/session";
import { rejectOrder, OrderOperationError } from "@/app/lib/orders/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/reject">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (session.role !== "ADMIN" && session.role !== "CLIENT_ADMIN") {
    return json(
      {
        error: "Forbidden: Only CLIENT_ADMIN or ADMIN may reject orders.",
        code: "FORBIDDEN",
      },
      403,
    );
  }

  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return json(
      {
        error: "Rejection reason is required",
        code: "REASON_REQUIRED",
      },
      400,
    );
  }

  const sendCustomerMessage = Boolean(body.sendCustomerMessage);
  const customerMessageText =
    typeof body.customerMessage === "string"
      ? body.customerMessage.trim()
      : typeof body.customerMessageText === "string"
        ? body.customerMessageText.trim()
        : null;

  try {
    const order = await rejectOrder({
      orderId: id,
      organizationId: session.organizationId,
      reason,
      actor: {
        id: session.userId,
        type: "USER",
        role: session.role,
        name: session.name,
      },
      sendCustomerMessage,
      customerMessageText,
    });

    return json({ order, rejected: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "REJECTION_FAILED";
    const status = code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 400;
    return json({ error: message, code }, status);
  }
}
