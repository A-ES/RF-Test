import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@rf-intelligence/db";

const SETUP_CHALLENGE_COOKIE = "rf_admin_setup_challenge";
const SETUP_CHALLENGE_DOMAIN = "rf-admin-setup:v1";
const SETUP_CHALLENGE_TTL_SECONDS = 15 * 60; // 15 minutes

export interface SetupStatus {
  available: boolean;
  reason?: string;
  defaultAdminId?: string;
  existingEmail?: string;
}

export interface SetupChallengeData {
  mode: "RF_ADMIN_SETUP";
  name: string;
  email: string;
  passwordHash: string;
  secret: string;
  iat: number;
}

function getSecret(): string {
  const secret = process.env.RF_ADMIN_SESSION_SECRET || "fallback-setup-dev-secret-32-chars-long";
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

function signatureMatches(token: string, domain: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(domain, payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  return payload;
}

/**
 * Checks whether the initial setup wizard is available to visitors.
 *
 * Setup is available if:
 * 1. ALLOW_ADMIN_SETUP is explicitly "true" in environment.
 * 2. Or no admin user exists in the database.
 * 3. Or the only admin user is the default seeded "admin@rf-intelligence.com"
 *    account that has not yet been personalized by the client.
 *
 * Once the client configures their own email (e.g. client@domain.com),
 * setup automatically shuts down and locks to prevent tampering.
 */
export async function isSetupAvailable(): Promise<SetupStatus> {
  if (process.env.ALLOW_ADMIN_SETUP === "true") {
    return { available: true, reason: "Explicitly allowed via ALLOW_ADMIN_SETUP=true" };
  }

  try {
    const admins = await prisma.rfAdminUser.findMany({
      select: { id: true, email: true },
      take: 2,
    });

    if (admins.length === 0) {
      return { available: true, reason: "No administrators configured" };
    }

    if (admins.length === 1 && admins[0].email === "admin@rf-intelligence.com") {
      return {
        available: true,
        reason: "Initial default admin pending personalization",
        defaultAdminId: admins[0].id,
        existingEmail: admins[0].email,
      };
    }

    return { available: false, reason: "Administrator already configured" };
  } catch (error) {
    console.error("Database check failed in isSetupAvailable:", error);
    // Return setup available as safe fallback so the client can access setup
    return { available: true, reason: "Database setup pending or uninitialized" };
  }
}

export function createSetupChallengeToken(data: {
  name: string;
  email: string;
  passwordHash: string;
  secret: string;
  now?: number;
}): string {
  return signPayload<SetupChallengeData>(SETUP_CHALLENGE_DOMAIN, {
    mode: "RF_ADMIN_SETUP",
    name: data.name,
    email: data.email,
    passwordHash: data.passwordHash,
    secret: data.secret,
    iat: data.now ?? Date.now(),
  });
}

export function verifySetupChallengeToken(
  token: string,
  now: number = Date.now(),
): SetupChallengeData | null {
  const payload = signatureMatches(token, SETUP_CHALLENGE_DOMAIN);
  if (!payload) return null;

  let decoded: SetupChallengeData;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (decoded?.mode !== "RF_ADMIN_SETUP") return null;
  if (!decoded.email || !decoded.passwordHash || !decoded.secret) return null;
  if (typeof decoded.iat !== "number") return null;
  if (now - decoded.iat > SETUP_CHALLENGE_TTL_SECONDS * 1000) return null;

  return decoded;
}

export async function setSetupChallengeCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SETUP_CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SETUP_CHALLENGE_TTL_SECONDS,
  });
}

export async function getSetupChallenge(): Promise<SetupChallengeData | null> {
  const store = await cookies();
  const token = store.get(SETUP_CHALLENGE_COOKIE)?.value;
  return token ? verifySetupChallengeToken(token) : null;
}

export async function clearSetupChallengeCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SETUP_CHALLENGE_COOKIE);
}
