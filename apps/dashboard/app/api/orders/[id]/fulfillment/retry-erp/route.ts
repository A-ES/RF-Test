import { getSession } from "@/app/lib/session";
import { retryErpSync } from "@/app/lib/fulfillment/service";
import { OrderOperationError } from "@/app/lib/orders/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/orders/[id]/fulfillment/retry-erp">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  try {
    const result = await retryErpSync({
      orderId: id,
      organizationId: session.organizationId,
      actor: {
        id: session.userId,
        role: session.role,
        name: session.name,
      },
    });

    return json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "RETRY_FAILED";
    return json({ error: message, code }, 400);
  }
}
