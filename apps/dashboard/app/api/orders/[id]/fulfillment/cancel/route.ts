import { getSession } from "@/app/lib/session";
import { cancelOrderBeforeDispatch } from "@/app/lib/fulfillment/service";
import { OrderOperationError } from "@/app/lib/orders/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/fulfillment/cancel">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "Cancelled by user";

  try {
    const updated = await cancelOrderBeforeDispatch({
      orderId: id,
      organizationId: session.organizationId,
      reason,
      actor: {
        id: session.userId,
        role: session.role,
        name: session.name,
      },
    });

    return json({ success: true, order: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "CANCEL_FAILED";
    return json({ error: message, code }, 400);
  }
}
