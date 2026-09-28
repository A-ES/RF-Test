import { getRfAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports whether the caller holds an RF Admin session, for the login page to
 * decide whether to redirect. Returns the admin's identity and nothing about
 * any other account.
 */
export async function GET(): Promise<Response> {
  const session = await getRfAdminSession();
  if (!session) return Response.json({ authenticated: false }, { status: 401 });
  return Response.json({ authenticated: true, session });
}
