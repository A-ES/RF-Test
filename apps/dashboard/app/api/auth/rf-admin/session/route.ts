import { requireRfAdminSession } from "@/app/lib/rf-admin-session";
import { withTiming } from "@/app/lib/timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports the signed-in RF admin, if any. Resolves against `RfAdminUser` via
 * the `rf_admin_session` cookie only; a client session is invisible here.
 */
export async function GET(): Promise<Response> {
  return withTiming("GET /api/auth/rf-admin/session", async () => {
    const auth = await requireRfAdminSession();
    if (!auth.ok) return auth.response;

    return Response.json({
      mode: auth.session.mode,
      user: {
        id: auth.session.adminId,
        name: auth.session.name,
        email: auth.session.email,
      },
    });
  });
}
