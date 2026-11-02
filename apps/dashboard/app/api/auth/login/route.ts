import { prisma } from "@/app/lib/db";
import { setSessionCookie } from "@/app/lib/session";
import { withTiming } from "@/app/lib/timing";
import { writeAuditLog } from "@/app/lib/audit";
import { verifyPassword, hashPassword, DUMMY_HASH } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export async function POST(request: Request): Promise<Response> {
  return withTiming("POST /api/auth/login", async () => {
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

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, organizationId: true },
    });

    // Always run scrypt verification even if the user does not exist or has a null
    // passwordHash, burning equivalent CPU time to prevent timing-based email enumeration.
    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
    const verification = await verifyPassword(password, hashToVerify);
    const valid = user != null && user.passwordHash != null && verification.valid;

    if (!user || !valid) {
      const ip = getClientIp(request);
      const timestamp = new Date().toISOString();
      const orgId = user?.organizationId || (await prisma.organization.findFirst({ select: { id: true } }))?.id || "";

      await writeAuditLog({
        organizationId: orgId,
        userId: user?.id,
        action: "LOGIN_FAILED",
        entityType: "User",
        entityId: user?.id ?? email,
        metadata: {
          email,
          ip,
          timestamp,
        },
      });

      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Opportunistically upgrade legacy SHA-256 hashes to scrypt on successful login
    if (verification.needsRehash) {
      const newHash = await hashPassword(password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });
    }

    await setSessionCookie(user.id);

    return Response.json({ ok: true });
  });
}
