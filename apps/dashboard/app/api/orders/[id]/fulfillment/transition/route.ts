import { getSession } from "@/app/lib/session";
import { transitionFulfillment } from "@/app/lib/fulfillment/service";
import { OrderOperationError } from "@/app/lib/orders/order-service";
import type { FulfillmentStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/fulfillment/transition">,
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

  const toStatus = body.toStatus as FulfillmentStatus;
  if (!toStatus || !["PENDING", "PACKING", "DISPATCHED", "DELIVERED"].includes(toStatus)) {
    return json({ error: "Invalid toStatus value" }, 400);
  }

  try {
    const result = await transitionFulfillment({
      orderId: id,
      organizationId: session.organizationId,
      toStatus,
      carrier: typeof body.carrier === "string" ? body.carrier.trim() : null,
      trackingRef: typeof body.trackingRef === "string" ? body.trackingRef.trim() : null,
      deliveryNote: typeof body.deliveryNote === "string" ? body.deliveryNote.trim() : null,
      notes: typeof body.notes === "string" ? body.notes.trim() : null,
      overrideReason: typeof body.overrideReason === "string" ? body.overrideReason.trim() : null,
      partialLines: Array.isArray(body.partialLines) ? body.partialLines : undefined,
      actor: {
        id: session.userId,
        role: session.role,
        name: session.name,
      },
    });

    return json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "TRANSITION_FAILED";
    let status = 400;
    if (code === "NOT_FOUND") status = 404;
    else if (code === "ILLEGAL_TRANSITION" || code === "FULFILLMENT_BLOCKED" || code === "REASON_REQUIRED") {
      status = 409;
    }
    return json({ error: message, code }, status);
  }
}
