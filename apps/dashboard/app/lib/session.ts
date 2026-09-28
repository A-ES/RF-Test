import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/app/lib/db";

export const SESSION_COOKIE = "rf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface Session {
  /**
   * Discriminates this session from an RF Admin console session. Always
   * "CLIENT" for sessions produced by `getSession`; RF Admin sessions are
   * produced only by `getRfAdminSession` in `app/lib/rf-admin-session.ts` and
   * carry `mode: "RF_ADMIN"`. Never widen this to a bare string.
   */
  mode: "CLIENT";
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  role: string;
  organization?: {
    id: string;
    name: string;
    plan: string;
  } | null;
}

interface TokenPayload {
  uid: string;
  iat: number;
}

// In-memory LRU cache for verified sessions: userId -> { session, expiresAt }
interface CachedSession {
  session: Session;
  expiresAt: number;
}
const sessionCache = new Map<string, CachedSession>();
const sessionInFlight = new Map<string, Promise<Session | null>>();
const SESSION_CACHE_TTL_MS = 45_000; // 45 seconds in-memory cache keyed by session/user id

export function invalidateSessionCache(userId: string) {
  sessionCache.delete(userId);
  sessionInFlight.delete(userId);
}

export function clearAllSessionCache() {
  sessionCache.clear();
  sessionInFlight.clear();
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * Creates a tamper-evident session token. The payload only carries the user id;
 * the organization id is NEVER trusted from the client and is always resolved
 * from the database in `getSession`.
 */
export function createSessionToken(userId: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, iat: now } satisfies TokenPayload),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(
  token: string,
  now: number = Date.now(),
): TokenPayload | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  let decoded: TokenPayload;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof decoded.uid !== "string" || typeof decoded.iat !== "number") return null;
  if (now - decoded.iat > SESSION_TTL_SECONDS * 1000) return null;

  return decoded;
}

/**
 * Resolves the current session from the signed, httpOnly cookie.
 * Validates the cookie first, checks in-memory cache (45s), and shares in-flight promises
 * so concurrent requests for the same session share one DB call without thundering herd.
 *
 * Reads `SESSION_COOKIE` only. It never reads `RF_ADMIN_SESSION_COOKIE` and never
 * resolves against `RfAdminUser` — see `app/lib/rf-admin-session.ts` for the
 * separate RF Admin console identity path.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const verified = verifySessionToken(token);
  if (!verified) return null;

  // Check in-memory cache
  const cached = sessionCache.get(verified.uid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.session;
  }

  // Deduplicate in-flight DB lookup for the same session
  const inFlight = sessionInFlight.get(verified.uid);
  if (inFlight) {
    return inFlight;
  }

  const lookupPromise = (async () => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: verified.uid },
        select: {
          id: true,
          organizationId: true,
          name: true,
          email: true,
          role: true,
          organization: {
            select: {
              id: true,
              name: true,
              plan: true,
            },
          },
        },
      });
      if (!user) return null;

      const session: Session = {
        mode: "CLIENT",
        userId: user.id,
        organizationId: user.organizationId,
        name: user.name,
        email: user.email,
        role: user.role,
        organization: user.organization,
      };

      // Cache combined session in memory
      sessionCache.set(verified.uid, {
        session,
        expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
      });

      return session;
    } finally {
      sessionInFlight.delete(verified.uid);
    }
  })();

  sessionInFlight.set(verified.uid, lookupPromise);
  return lookupPromise;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const verified = verifySessionToken(token);
    if (verified) {
      invalidateSessionCache(verified.uid);
    }
  }
  store.delete(SESSION_COOKIE);
}
