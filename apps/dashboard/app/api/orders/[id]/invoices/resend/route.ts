import { getSession } from "@/app/lib/session";
import { resendInvoiceNotification } from "@/app/lib/invoices/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: Request,
  _ctx: RouteContext<"/api/orders/[id]/invoices/resend">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  if (!invoiceId) {
    return json({ error: "invoiceId is required" }, 400);
  }

  try {
    const result = await resendInvoiceNotification({
      invoiceId,
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
    return json({ error: message }, 400);
  }
}
