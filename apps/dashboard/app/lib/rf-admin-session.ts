import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/app/lib/db";

/**
 * RF Admin console session.
 *
 * This is a deliberately separate identity path from the client-user session in
 * `app/lib/session.ts`. An RF admin is RF Intelligence staff who spans every
 * tenant, so they do not belong to any `Organization` and are stored in
 * `RfAdminUser` rather than `User`.
 *
 * There are four independent barriers between the two, because a cross-tenant
 * privilege escalation here would be catastrophic:
 *
 *   1. A different table. `RfAdminUser` has no `organizationId` and is not
 *      reachable from any `Organization` relation.
 *   2. A different cookie. `rf_admin_session` vs `rf_session`, so the browser
 *      sends them separately and neither route reads the other's cookie.
 *   3. Domain-separated signing. Both schemes may share `AUTH_SECRET`, but the
 *      admin signature is computed over a `"rf-admin:v1"` prefix, so a token
 *      minted for one can never verify under the other.
 *   4. An explicit mode discriminant on the session object itself. Code that
 *      consumes a session can branch on `mode` and cannot be handed an admin
 *      session by accident.
 *
 * The intended guarantee is that a regular `User` account can NEVER be promoted
 * to RF Admin by a data bug: there is no role flag, no boolean, and no nullable
 * column on `User` that this module reads. `getRfAdminSession` resolves ids
 * against `RfAdminUser` only, so an id belonging to `User` simply will not
 * resolve and the session comes back null.
 */
export const RF_ADMIN_SESSION_COOKIE = "rf_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours — shorter than the client session
const SIGNING_DOMAIN = "rf-admin:v1";

export interface RfAdminSession {
  mode: "RF_ADMIN";
  adminId: string;
  name: string;
  email: string;
}

interface RfAdminTokenPayload {
  mode: "RF_ADMIN";
  uid: string;
  iat: number;
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret())
    .update(SIGNING_DOMAIN)
    .update(payload)
    .digest("base64url");
}

export function createRfAdminSessionToken(
  adminId: string,
  now: number = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ mode: "RF_ADMIN", uid: adminId, iat: now } satisfies RfAdminTokenPayload),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyRfAdminSessionToken(
  token: string,
  now: number = Date.now(),
): RfAdminTokenPayload | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  let decoded: RfAdminTokenPayload;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  // The mode is carried in the signed payload and re-checked here, so a token
  // that is validly signed but not an RF admin token is rejected outright.
  if (decoded?.mode !== "RF_ADMIN") return null;
  if (typeof decoded.uid !== "string" || typeof decoded.iat !== "number") return null;
  if (now - decoded.iat > SESSION_TTL_SECONDS * 1000) return null;

  return decoded;
}

/**
 * Resolves the current RF Admin session from the `rf_admin_session` cookie.
 *
 * Reads that cookie and no other. Resolves the id against `RfAdminUser` only —
 * never `User` — so a client user id cannot produce an RF admin session no
 * matter how it arrives. Deactivated admins are treated as signed out.
 */
export async function getRfAdminSession(): Promise<RfAdminSession | null> {
  const store = await cookies();
  const token = store.get(RF_ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;

  const verified = verifyRfAdminSessionToken(token);
  if (!verified) return null;

  const admin = await prisma.rfAdminUser.findUnique({
    where: { id: verified.uid },
    select: { id: true, name: true, email: true, isActive: true },
  });
  if (!admin || !admin.isActive) return null;

  return {
    mode: "RF_ADMIN",
    adminId: admin.id,
    name: admin.name,
    email: admin.email,
  };
}

/**
 * Guard for RF Admin console routes. Returns the session, or a 401 Response
 * ready to be returned from the handler. Never falls back to a client session.
 */
export async function requireRfAdminSession(): Promise<
  { ok: true; session: RfAdminSession } | { ok: false; response: Response }
> {
  const session = await getRfAdminSession();
  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, session };
}

export async function setRfAdminSessionCookie(adminId: string): Promise<void> {
  const store = await cookies();
  store.set(RF_ADMIN_SESSION_COOKIE, createRfAdminSessionToken(adminId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearRfAdminSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(RF_ADMIN_SESSION_COOKIE);
}
