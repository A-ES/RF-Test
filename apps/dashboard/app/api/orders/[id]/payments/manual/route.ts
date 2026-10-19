import { getSession } from "@/app/lib/session";
import { recordManualPayment } from "@/app/lib/payments/service";
import { OrderOperationError } from "@/app/lib/orders/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/payments/manual">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (session.role !== "ADMIN" && session.role !== "CLIENT_ADMIN") {
    return json({ error: "Forbidden: Only administrators may record manual payments", code: "FORBIDDEN" }, 403);
  }

  const { id } = await ctx.params;

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const amountMinor = typeof body.amountMinor === "number" ? body.amountMinor : 0;
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

  if (amountMinor <= 0) {
    return json({ error: "amountMinor must be a positive number", code: "INVALID_AMOUNT" }, 400);
  }

  try {
    const result = await recordManualPayment({
      orderId: id,
      organizationId: session.organizationId,
      amountMinor,
      reference,
      notes,
      actor: {
        id: session.userId,
        role: session.role,
        name: session.name,
      },
    });

    return json({ success: true, payment: result.payment, order: result.order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "PAYMENT_FAILED";
    let status = 400;
    if (code === "NOT_FOUND") status = 404;
    return json({ error: message, code }, status);
  }
}
