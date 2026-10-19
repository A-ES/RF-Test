/**
 * POST /api/orders/:id/approve — Explicit administrator confirmation gate.
 *
 * Runs in ONE transaction:
 * - Role: CLIENT_ADMIN or ADMIN only
 * - Status: DRAFT | NEEDS_REVIEW
 * - Optimistic concurrency on version (409 on mismatch)
 * - Re-price and re-check stock (409 with shortages if stock fell)
 * - Blocking flags: prevented unless admin provides an explicit logged overrideReason
 * - Allocates sequential orderNumber from OrgCounter
 * - Reserves stock via InventoryProvider
 * - Creates Fulfillment row (PENDING)
 * - Writes OrderEvents
 * - Idempotency key: retries return same result
 * - After commit: emits order.approved over Ably (customer-facing steps only happen from that event)
 */
import { getSession } from "@/app/lib/session";
import { approveOrder, OrderOperationError } from "@/app/lib/orders/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/approve">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  // Enforce role authorization
  if (session.role !== "ADMIN" && session.role !== "CLIENT_ADMIN") {
    return json(
      {
        error: "Forbidden: Only CLIENT_ADMIN or ADMIN may approve orders.",
        code: "FORBIDDEN",
      },
      403,
    );
  }

  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      body = JSON.parse(text);
    }
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const idempotencyKey =
    (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()) ||
    request.headers.get("idempotency-key") ||
    null;

  const version = typeof body.version === "number" ? body.version : undefined;
  const overrideBlockingFlags = Boolean(body.overrideBlockingFlags);
  const overrideReason =
    typeof body.overrideReason === "string" ? body.overrideReason.trim() : null;

  try {
    const order = await approveOrder({
      orderId: id,
      organizationId: session.organizationId,
      approver: {
        id: session.userId,
        role: session.role,
        name: session.name,
      },
      version,
      idempotencyKey,
      overrideBlockingFlags,
      overrideReason,
    });

    return json({ order, approved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "APPROVAL_FAILED";

    let status = 400;
    if (code === "NOT_FOUND") status = 404;
    else if (code === "FORBIDDEN") status = 403;
    else if (code === "VERSION_CONFLICT" || code === "STOCK_SHORTAGE" || code === "ALREADY_APPROVED") {
      status = 409;
    }

    return json({ error: message, code }, status);
  }
}
