import { getDatabaseRoleInfo } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness plus a read-only statement of which database credential this process
 * is actually using. Reporting `bypassRls` makes a credential mix-up visible in
 * monitoring instead of silently changing what the app can see.
 */
export async function GET(): Promise<Response> {
  try {
    const role = await getDatabaseRoleInfo();
    return Response.json({
      ok: true,
      database: {
        currentUser: role.currentUser,
        bypassRls: role.bypassRls,
        isSuperuser: role.isSuperuser,
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "database unreachable" },
      { status: 503 },
    );
  }
}
