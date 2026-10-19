import { getSession } from "@/app/lib/session";
import { voidAndReissueInvoice } from "@/app/lib/invoices/service";
import { OrderOperationError } from "@/app/lib/orders/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/invoices/void-reissue">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (session.role !== "ADMIN" && session.role !== "CLIENT_ADMIN") {
    return json({ error: "Forbidden: Only administrators may void and reissue invoices" }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!invoiceId) {
    return json({ error: "invoiceId is required" }, 400);
  }
  if (!reason) {
    return json({ error: "A void and reissue reason is required" }, 400);
  }

  try {
    const reissued = await voidAndReissueInvoice({
      invoiceId,
      organizationId: session.organizationId,
      reason,
      actor: {
        id: session.userId,
        role: session.role,
        name: session.name,
      },
    });

    return json({ success: true, invoice: reissued });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof OrderOperationError ? err.code : "VOID_FAILED";
    let status = 400;
    if (code === "NOT_FOUND") status = 404;
    return json({ error: message, code }, status);
  }
}
