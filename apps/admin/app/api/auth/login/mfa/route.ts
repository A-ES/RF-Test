import { prisma } from "@rf-intelligence/db";
import { recordAuditEvent } from "@/lib/audit";
import { completeMfaChallenge } from "@/lib/mfa";
import {
  clearMfaChallengeCookie,
  getMfaChallenge,
  setRfAdminSessionCookie,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RF Admin sign-in, step 2 of 2: the TOTP code.
 *
 * The only place in the codebase that can mint an `rf_admin_session`. It
 * requires a valid pending challenge *and* a valid, unreplayed TOTP code, so
 * possessing a password alone never yields a session.
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = (payload ?? {}) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";

  const challenge = await getMfaChallenge();
  if (!challenge) {
    return Response.json(
      { error: "Sign-in expired. Please enter your password again." },
      { status: 401 },
    );
  }

  if (!code) {
    return Response.json({ error: "A verification code is required" }, { status: 400 });
  }

  const outcome = await completeMfaChallenge(challenge, code);

  switch (outcome.status) {
    case "ok": {
      await clearMfaChallengeCookie();
      await setRfAdminSessionCookie(outcome.adminId);
      await prisma.rfAdminUser.update({
        where: { id: outcome.adminId },
        data: { lastLoginAt: new Date(), lastFailedLoginAt: null },
      });
      await recordAuditEvent(
        {
          adminId: outcome.adminId,
          action: "admin.login.success",
          entityType: "RfAdminUser",
          entityId: outcome.adminId,
        },
        request,
      );
      return Response.json({ ok: true });
    }

    case "locked_out": {
      // The challenge is spent regardless: a lockout must not be escapable by
      // retrying the second step with a fresh challenge.
      await clearMfaChallengeCookie();
      await recordAuditEvent(
        {
          adminId: challenge.adminId,
          action: "admin.login.locked_out",
          entityType: "RfAdminUser",
          entityId: challenge.adminId,
          succeeded: false,
        },
        request,
      );
      return Response.json(
        {
          error: "Too many failed attempts. Try again later.",
          retryAfterSeconds: outcome.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(outcome.retryAfterSeconds) } },
      );
    }

    case "replayed": {
      await clearMfaChallengeCookie();
      await recordAuditEvent(
        {
          adminId: challenge.adminId,
          action: "admin.login.replay_rejected",
          entityType: "RfAdminUser",
          entityId: challenge.adminId,
          succeeded: false,
        },
        request,
      );
      return Response.json(
        { error: "That code has already been used. Please sign in again." },
        { status: 401 },
      );
    }

    case "not_enrolled":
    case "challenge_mismatch":
    case "challenge_stale": {
      await clearMfaChallengeCookie();
      return Response.json(
        { error: "Verification is unavailable for this account." },
        { status: 401 },
      );
    }

    case "invalid_code":
    default: {
      await recordAuditEvent(
        {
          adminId: challenge.adminId,
          action: "admin.login.mfa_rejected",
          entityType: "RfAdminUser",
          entityId: challenge.adminId,
          succeeded: false,
        },
        request,
      );
      return Response.json({ error: "That code is not valid" }, { status: 401 });
    }
  }
}
