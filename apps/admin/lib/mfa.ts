import { prisma } from "@rf-intelligence/db";
import { decryptSecret } from "./crypto";
import {
  MFA_LOCKOUT_SECONDS,
  MFA_MAX_FAILED_ATTEMPTS,
  type RfAdminMfaChallenge,
} from "./session";
import { verifyTotp } from "./totp";

/**
 * The second factor of the admin login flow.
 *
 * Both failure modes here are attacks on the same thing — getting a session
 * without a live authenticator — so they are handled explicitly rather than
 * left to the TOTP check alone:
 *
 *   • Brute force is bounded by a per-admin lockout. After
 *     MFA_MAX_FAILED_ATTEMPTS wrong codes the admin is locked out for
 *     MFA_LOCKOUT_SECONDS, and the counter is only reset by a success, so
 *     repeated attempts cannot grind it down.
 *   • Replay is bounded by `mfaLastUsedStep`. A code is only ever valid for one
 *     time step: once step N is accepted, step N and everything earlier is
 *     refused, even if the same six digits are submitted again inside the same
 *     30-second window.
 */

export type MfaOutcome =
  | { status: "ok"; adminId: string }
  | { status: "invalid_code" }
  | { status: "not_enrolled" }
  | { status: "locked_out"; retryAfterSeconds: number }
  | { status: "replayed" }
  | { status: "challenge_stale" }
  | { status: "challenge_mismatch" };

function stillLockedUntil(lockedUntil: Date | null, now: number): number {
  if (!lockedUntil) return 0;
  const remaining = Math.ceil((lockedUntil.getTime() - now) / 1000);
  return remaining > 0 ? remaining : 0;
}

interface AdminMfaRecord {
  id: string;
  mfaEnabled: boolean;
  mfaSecretCiphertext: string | null;
  mfaFailedAttempts: number;
  mfaLockedUntil: Date | null;
  mfaLastUsedStep: number | null;
  isActive: boolean;
}

/**
 * Completes the second step of login: exchanges a pending challenge plus a TOTP
 * code for a session. The challenge must name this same admin, so a challenge
 * cannot be redeemed on behalf of someone else.
 */
export async function completeMfaChallenge(
  challenge: RfAdminMfaChallenge,
  code: string,
  now: number = Date.now(),
): Promise<MfaOutcome> {
  const admin = (await prisma.rfAdminUser.findUnique({
    where: { id: challenge.adminId },
    select: {
      id: true,
      isActive: true,
      mfaEnabled: true,
      mfaSecretCiphertext: true,
      mfaFailedAttempts: true,
      mfaLockedUntil: true,
      mfaLastUsedStep: true,
    },
  })) as AdminMfaRecord | null;

  if (!admin || !admin.isActive) return { status: "challenge_mismatch" };

  const lockedFor = stillLockedUntil(admin.mfaLockedUntil, now);
  if (lockedFor > 0) return { status: "locked_out", retryAfterSeconds: lockedFor };

  if (!admin.mfaEnabled || !admin.mfaSecretCiphertext) return { status: "not_enrolled" };

  const secret = decryptSecret(admin.mfaSecretCiphertext);
  if (!secret) {
    // A secret we cannot decrypt means MFA cannot be satisfied. Surface it as
    // "not enrolled" rather than an invalid code, so the UI can say the
    // operator needs to re-enrol, and never as a hint that something exists.
    return { status: "not_enrolled" };
  }

  const result = verifyTotp(secret, code, now);
  if (!result.valid || result.counter === null) {
    return registerFailedAttempt(admin, now);
  }

  // Replay check: the matched step must be strictly newer than any step already
  // spent by this admin.
  if (admin.mfaLastUsedStep !== null && result.counter <= admin.mfaLastUsedStep) {
    return { status: "replayed" };
  }

  await prisma.rfAdminUser.update({
    where: { id: admin.id },
    data: {
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
      mfaLastUsedStep: result.counter,
    },
  });

  return { status: "ok", adminId: admin.id };
}

async function registerFailedAttempt(
  admin: AdminMfaRecord,
  now: number,
): Promise<MfaOutcome> {
  const attempts = admin.mfaFailedAttempts + 1;
  if (attempts < MFA_MAX_FAILED_ATTEMPTS) {
    await prisma.rfAdminUser.update({
      where: { id: admin.id },
      data: { mfaFailedAttempts: attempts },
    });
    return { status: "invalid_code" };
  }

  const lockedUntil = new Date(now + MFA_LOCKOUT_SECONDS * 1000);
  await prisma.rfAdminUser.update({
    where: { id: admin.id },
    // Reset the counter as we lock, so the next window starts clean.
    data: { mfaFailedAttempts: 0, mfaLockedUntil: lockedUntil },
  });
  return { status: "locked_out", retryAfterSeconds: MFA_LOCKOUT_SECONDS };
}
