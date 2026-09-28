import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@rf-intelligence/db";

/**
 * RF Admin console session — the *only* identity path in apps/admin.
 *
 * An RF admin is RF Intelligence staff who spans every tenant, so they belong to
 * no `Organization` and are stored in `RfAdminUser`, never in `User`. There is
 * no role flag, no boolean and no nullable column on `User` that this module
 * reads, which is what makes "a client user can never be promoted to RF Admin"
 * a structural property rather than a runtime check someone can forget.
 *
 * Five independent barriers separate this from the dashboard's `rf_session`:
 *
 *   1. A different table. `RfAdminUser` has no `organizationId` and is not
 *      reachable from any `Organization` relation.
 *   2. A different app. This code does not exist in apps/dashboard, and
 *      apps/admin does not import the dashboard's session module.
 *   3. A different cookie on a different host. `rf_admin_session` is set on
 *      admin.rfintelligence.<domain> with no `Domain` attribute, so the browser
 *      never attaches it to dashboard.rfintelligence.<domain> and vice versa.
 *   4. A different signing key. The dashboard signs with AUTH_SECRET; this signs
 *      with RF_ADMIN_SESSION_SECRET. Sharing a key would let a token minted by
 *      one app verify in the other, so the two must be distinct values.
 *   5. Domain-separated signatures *and* an explicit `mode` discriminant,
 *      re-checked after verification, so a validly-signed non-admin token is
 *      rejected outright.
 *
 * MFA is not optional. `verifyAdminCredentials` deliberately does not issue a
 * session: it issues a short-lived, single-purpose challenge that can only be
 * exchanged for a session by `completeMfaChallenge`, which requires a valid
 * TOTP code. An admin with `mfaEnabled = false` cannot obtain a session at all.
 */
/**
 * The `__Host-` prefix is only honoured by browsers on a secure cookie, so it
 * is applied in production only. Baking it into the name (rather than using
 * Next's `prefix` write option) keeps the read and write sides identical in
 * every environment — otherwise production would store `__Host-rf_admin_session`
 * while this module still looked up `rf_admin_session` and never find it.
 */
const COOKIE_PREFIX = process.env.NODE_ENV === "production" ? "__Host-" : "";
export const RF_ADMIN_SESSION_COOKIE = `${COOKIE_PREFIX}rf_admin_session`;
export const RF_ADMIN_MFA_COOKIE = `${COOKIE_PREFIX}rf_admin_mfa_pending`;

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
/** The credentials->MFA step is deliberately short; the password is already proven. */
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const SIGNING_DOMAIN = "rf-admin:v1";
const CHALLENGE_SIGNING_DOMAIN = "rf-admin-mfa:v1";

/** Lockout after this many consecutive failed TOTP codes. */
export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCKOUT_SECONDS = 15 * 60;

export interface RfAdminSession {
  mode: "RF_ADMIN";
  adminId: string;
  name: string;
  email: string;
}

export interface RfAdminMfaChallenge {
  mode: "RF_ADMIN_MFA";
  adminId: string;
  /** Random per-challenge nonce: forces a fresh TOTP step even if a code is replayed. */
  nonce: string;
  iat: number;
}

interface SessionTokenPayload {
  mode: "RF_ADMIN";
  uid: string;
  /** Records that this session was established through a verified TOTP step. */
  mfa: true;
  iat: number;
}

function getSecret(): string {
  const secret = process.env.RF_ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("RF_ADMIN_SESSION_SECRET is not configured");
  return secret;
}

function sign(domain: string, payload: string): string {
  return createHmac("sha256", getSecret())
    .update(domain)
    .update(payload)
    .digest("base64url");
}

function signPayload<T>(domain: string, value: T): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(domain, payload)}`;
}

/** Constant-time signature check that also tolerates a malformed token. */
function signatureMatches(token: string, domain: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(domain, payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  return payload;
}

export function createRfAdminSessionToken(adminId: string, now: number = Date.now()): string {
  return signPayload<SessionTokenPayload>(SIGNING_DOMAIN, {
    mode: "RF_ADMIN",
    uid: adminId,
    mfa: true,
    iat: now,
  });
}

export function verifyRfAdminSessionToken(
  token: string,
  now: number = Date.now(),
): SessionTokenPayload | null {
  const payload = signatureMatches(token, SIGNING_DOMAIN);
  if (!payload) return null;

  let decoded: SessionTokenPayload;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (decoded?.mode !== "RF_ADMIN") return null;
  if (decoded.mfa !== true) return null;
  if (typeof decoded.uid !== "string" || typeof decoded.iat !== "number") return null;
  if (now - decoded.iat > SESSION_TTL_SECONDS * 1000) return null;
  return decoded;
}

export function createMfaChallenge(
  adminId: string,
  nonce: string,
  now: number = Date.now(),
): string {
  return signPayload<RfAdminMfaChallenge>(CHALLENGE_SIGNING_DOMAIN, {
    mode: "RF_ADMIN_MFA",
    adminId,
    nonce,
    iat: now,
  });
}

export function verifyMfaChallenge(
  token: string,
  now: number = Date.now(),
): RfAdminMfaChallenge | null {
  const payload = signatureMatches(token, CHALLENGE_SIGNING_DOMAIN);
  if (!payload) return null;

  let decoded: RfAdminMfaChallenge;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (decoded?.mode !== "RF_ADMIN_MFA") return null;
  if (typeof decoded.adminId !== "string" || typeof decoded.nonce !== "string") return null;
  if (typeof decoded.iat !== "number") return null;
  if (now - decoded.iat > MFA_CHALLENGE_TTL_SECONDS * 1000) return null;
  return decoded;
}

/**
 * Resolves the current RF Admin session from the `rf_admin_session` cookie.
 *
 * Reads that cookie and no other — never `rf_session` — and resolves the id
 * against `RfAdminUser` only, so a client `User` id cannot produce a session no
 * matter how it arrives. Deactivated admins read as signed out.
 */
export async function getRfAdminSession(): Promise<RfAdminSession | null> {
  const store = await cookies();
  const token = store.get(RF_ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;

  const verified = verifyRfAdminSessionToken(token);
  if (!verified) return null;

  const admin = await prisma.rfAdminUser.findUnique({
    where: { id: verified.uid },
    select: { id: true, name: true, email: true, isActive: true, mfaEnabled: true },
  });
  // An admin whose MFA was revoked mid-session loses access immediately.
  if (!admin || !admin.isActive || !admin.mfaEnabled) return null;

  return { mode: "RF_ADMIN", adminId: admin.id, name: admin.name, email: admin.email };
}

export async function requireRfAdminSession(): Promise<
  { ok: true; session: RfAdminSession } | { ok: false; response: Response }
> {
  const session = await getRfAdminSession();
  if (!session) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, session };
}

/**
 * Cookie options shared by both admin cookies.
 *
 * No `domain` key at all: that is what makes a cookie host-only, so the browser
 * scopes it to this exact host and never to the parent zone. `secure` is on in
 * production, which also means the `__Host-` prefix below is only valid there.
 */
function baseCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function setRfAdminSessionCookie(adminId: string): Promise<void> {
  const store = await cookies();
  store.set(
    RF_ADMIN_SESSION_COOKIE,
    createRfAdminSessionToken(adminId),
    baseCookieOptions(SESSION_TTL_SECONDS),
  );
}

export async function clearRfAdminSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(RF_ADMIN_SESSION_COOKIE);
}

export async function setMfaChallengeCookie(
  adminId: string,
  nonce: string,
): Promise<void> {
  const store = await cookies();
  store.set(
    RF_ADMIN_MFA_COOKIE,
    createMfaChallenge(adminId, nonce),
    baseCookieOptions(MFA_CHALLENGE_TTL_SECONDS),
  );
}

export async function getMfaChallenge(): Promise<RfAdminMfaChallenge | null> {
  const store = await cookies();
  const token = store.get(RF_ADMIN_MFA_COOKIE)?.value;
  return token ? verifyMfaChallenge(token) : null;
}

export async function clearMfaChallengeCookie(): Promise<void> {
  const store = await cookies();
  store.delete(RF_ADMIN_MFA_COOKIE);
}
