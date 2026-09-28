import { randomBytes } from "node:crypto";
import { prisma } from "@rf-intelligence/db";
import { recordAuditEvent } from "@/lib/audit";
import { verifyPassword } from "@/lib/password";
import { setMfaChallengeCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RF Admin sign-in, step 1 of 2: credentials.
 *
 * This handler touches `RfAdminUser` only. It never queries `User` and never
 * issues the dashboard's `rf_session` cookie, so a client credential pair posted
 * here cannot produce a session — the row simply does not exist. Conversely, an
 * RF admin credential pair posted to the dashboard login route is inert there.
 *
 * On success it does NOT create a session. It sets a short-lived, single-purpose
 * MFA challenge that only `POST /api/auth/login/mfa` can exchange for a
 * session, and only with a valid TOTP code. MFA is therefore not optional: an
 * admin whose `mfaEnabled` is false gets no session at any point in the flow.
 */
export async function POST(request: Request): Promise<Response> {
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
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const admin = await prisma.rfAdminUser.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      mfaEnabled: true,
      mfaLockedUntil: true,
      email: true,
    },
  });

  // Always perform a real hash comparison, even when no row matched, so response
  // timing does not reveal whether an RF admin email exists. The dummy verify
  // costs the same scrypt work as a real one.
  const verification = admin
    ? await verifyPassword(password, admin.passwordHash)
    : await verifyPassword(password, DUMMY_HASH);
  const valid = admin != null && verification.valid;

  if (!admin || !valid || !admin.isActive || !admin.mfaEnabled) {
    await recordAuditEvent(
      {
        adminId: admin?.id ?? null,
        action: "admin.login.credentials_rejected",
        entityType: "RfAdminUser",
        targetEmail: email,
        succeeded: false,
      },
      request,
    );
    // One message for every failure mode: unknown email, wrong password, and
    // deactivated account are indistinguishable to the caller.
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // A password is not enough while a lockout is in force; the TOTP step would
  // otherwise be the only thing checking the clock.
  if (admin.mfaLockedUntil && admin.mfaLockedUntil.getTime() > Date.now()) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Opportunistically upgrade a legacy SHA-256 digest to scrypt.
  if (verification.needsRehash) {
    const { hashPassword } = await import("@/lib/password");
    await prisma.rfAdminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  const challenge = randomBytes(32).toString("base64url");
  await setMfaChallengeCookie(admin.id, challenge);
  await recordAuditEvent(
    {
      adminId: admin.id,
      action: "admin.login.mfa_required",
      entityType: "RfAdminUser",
      entityId: admin.id,
      targetEmail: admin.email,
    },
    request,
  );

  return Response.json({ ok: true, mfaRequired: true });
}

/**
 * A well-formed scrypt hash of a random value, used only to burn equivalent CPU
 * on a login attempt for an address that does not exist. Regenerated per process
 * start so it can never be matched against a real password.
 */
const DUMMY_HASH = [
  "scrypt",
  16384,
  8,
  1,
  randomBytes(16).toString("base64"),
  randomBytes(32).toString("base64"),
].join("$");
