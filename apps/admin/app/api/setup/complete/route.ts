import { randomBytes } from "node:crypto";
import { prisma } from "@rf-intelligence/db";
import { encryptSecret } from "@/lib/crypto";
import { verifyTotp } from "@/lib/totp";
import { recordAuditEvent } from "@/lib/audit";
import { setRfAdminSessionCookie } from "@/lib/session";
import {
  clearSetupChallengeCookie,
  getSetupChallenge,
  isSetupAvailable,
} from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const setupState = await isSetupAvailable();
  if (!setupState.available) {
    return Response.json(
      { error: "Setup has already been completed. Please sign in." },
      { status: 403 },
    );
  }

  const challenge = await getSetupChallenge();
  if (!challenge) {
    return Response.json(
      { error: "Setup session expired. Please enter your account details again." },
      { status: 400 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = (payload ?? {}) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim().replace(/\s+/g, "") : "";

  if (!code || code.length !== 6) {
    return Response.json(
      { error: "Please enter the 6-digit code shown in your authenticator app" },
      { status: 400 },
    );
  }

  const result = verifyTotp(challenge.secret, code);
  if (!result.valid) {
    return Response.json(
      { error: "Invalid verification code. Please check your authenticator and try again." },
      { status: 400 },
    );
  }

  // Encrypt the MFA secret with AES-256-GCM
  const mfaSecretCiphertext = encryptSecret(challenge.secret);

  let adminId: string;

  if (setupState.defaultAdminId) {
    // Update existing seeded placeholder admin
    const updated = await prisma.rfAdminUser.update({
      where: { id: setupState.defaultAdminId },
      data: {
        name: challenge.name,
        email: challenge.email,
        passwordHash: challenge.passwordHash,
        mfaSecretCiphertext,
        mfaEnabled: true,
        mfaEnrolledAt: new Date(),
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        mfaLastUsedStep: result.counter,
        isActive: true,
        lastLoginAt: new Date(),
      },
      select: { id: true, email: true },
    });
    adminId = updated.id;
  } else {
    // Create new admin
    const newId = `rfa_${randomBytes(8).toString("hex")}`;
    const created = await prisma.rfAdminUser.create({
      data: {
        id: newId,
        name: challenge.name,
        email: challenge.email,
        passwordHash: challenge.passwordHash,
        mfaSecretCiphertext,
        mfaEnabled: true,
        mfaEnrolledAt: new Date(),
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        mfaLastUsedStep: result.counter,
        isActive: true,
        lastLoginAt: new Date(),
      },
      select: { id: true, email: true },
    });
    adminId = created.id;
  }

  // Clear temporary setup challenge cookie
  await clearSetupChallengeCookie();

  // Log audit event
  await recordAuditEvent(
    {
      adminId,
      action: "rf_admin.initial_setup.completed",
      entityType: "rf_admin_user",
      entityId: adminId,
      targetEmail: challenge.email,
      succeeded: true,
    },
    request,
  );

  // Directly log the user in by minting an authenticated session cookie!
  await setRfAdminSessionCookie(adminId);

  return Response.json({
    ok: true,
    message: "Admin setup completed successfully",
    redirect: "/console/organizations",
  });
}
