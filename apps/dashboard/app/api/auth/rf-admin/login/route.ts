import { createHash } from "node:crypto";
import { prisma } from "@/app/lib/db";
import { setRfAdminSessionCookie } from "@/app/lib/rf-admin-session";
import { withTiming } from "@/app/lib/timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RF Admin console sign-in. Completely separate from POST /api/auth/login.
 *
 * This handler touches `RfAdminUser` only. It never queries `User`, and it
 * never issues the `rf_session` cookie, so a client-user credential pair posted
 * here cannot produce a session — the row simply will not be found. Conversely
 * an RF admin credential pair posted to /api/auth/login is likewise inert.
 *
 * There is no demo-password fallback here, unlike the client login route: this
 * is the cross-tenant privilege path, so a seeded admin must have a real
 * `passwordHash`.
 */
export async function POST(request: Request): Promise<Response> {
  return withTiming("POST /api/auth/rf-admin/login", async () => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const body = (payload ?? {}) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const admin = await prisma.rfAdminUser.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, isActive: true },
    });

    // Always run the comparison even when no row matched, so response timing
    // does not reveal whether an RF admin email exists.
    // NOTE: In production swap this for bcrypt (install `bcryptjs`) or argon2.
    // SHA-256 is used here to match the client login route, because no
    // password-hashing library is installed in this repository.
    const incomingHash = createHash("sha256").update(password).digest("hex");
    const valid = admin != null && admin.passwordHash === incomingHash;

    if (!admin || !valid || !admin.isActive) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    await setRfAdminSessionCookie(admin.id);
    await prisma.rfAdminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    return Response.json({ ok: true });
  });
}
