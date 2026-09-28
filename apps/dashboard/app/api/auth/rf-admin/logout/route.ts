import { clearRfAdminSessionCookie } from "@/app/lib/rf-admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Signs out of the RF Admin console. Clears `rf_admin_session` only, so a
 * simultaneously-open client session is left untouched.
 */
export async function POST(): Promise<Response> {
  await clearRfAdminSessionCookie();
  return Response.json({ ok: true });
}
