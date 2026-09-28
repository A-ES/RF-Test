import { getRfAdminSession, clearMfaChallengeCookie, clearRfAdminSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ends the RF Admin session. Clears both cookies, and always reports success so
 * a stale or already-absent cookie is not distinguishable from a clean logout.
 */
export async function POST(): Promise<Response> {
  const session = await getRfAdminSession();
  await clearRfAdminSessionCookie();
  await clearMfaChallengeCookie();
  return Response.json({ ok: true, wasAuthenticated: session !== null });
}
