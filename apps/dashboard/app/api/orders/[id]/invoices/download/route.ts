import { getSession } from "@/app/lib/session";
import { getInvoiceSignedDownloadUrl } from "@/app/lib/invoices/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(
  request: Request,
  _ctx: RouteContext<"/api/orders/[id]/invoices/download">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const invoiceId = url.searchParams.get("invoiceId");

  if (!invoiceId) {
    return json({ error: "invoiceId query parameter is required" }, 400);
  }

  try {
    const downloadUrl = await getInvoiceSignedDownloadUrl(invoiceId, session.organizationId);
    return json({ downloadUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 404);
  }
}
