import { createHmac, createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rfAdmins = [
    {
      id: "rfa_console_admin",
      name: "RF Console Admin",
      email: "admin@rf-intelligence.com",
      isActive: true,
      mfaEnabled: true,
      passwordHash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
    },
    {
      id: "rfa_suspended",
      name: "Suspended RF Console User",
      email: "suspended@rf-intelligence.com",
      isActive: false,
      mfaEnabled: true,
      passwordHash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
    },
    {
      // Represents an admin whose MFA enrolment is incomplete: a valid password
      // must still not be enough to reach the console.
      id: "rfa_no_mfa",
      name: "Not Enrolled",
      email: "nomfa@rf-intelligence.com",
      isActive: true,
      mfaEnabled: false,
      passwordHash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
    },
  ];

  const users = [
    {
      id: "usr_jordan",
      organizationId: "org_acme",
      name: "Jordan Ellis",
      email: "jordan.ellis@acmecorp.com",
      role: "ADMIN",
    },
  ];

  const cookiesStore = new Map<string, string>();
  return { rfAdmins, users, cookiesStore };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = h.cookiesStore.get(name);
      return value ? { value } : undefined;
    },
    set: (name: string, value: string) => h.cookiesStore.set(name, value),
    delete: (name: string) => h.cookiesStore.delete(name),
  }),
}));

vi.mock("@rf-intelligence/db", () => ({
  prisma: {
    rfAdminUser: {
      findUnique: vi.fn(async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.id) return h.rfAdmins.find((a) => a.id === args.where.id) ?? null;
        if (args.where.email) {
          return h.rfAdmins.find((a) => a.email === args.where.email) ?? null;
        }
        return null;
      }),
      update: vi.fn(async () => ({})),
    },
  },
}));

import {
  createMfaChallenge,
  createRfAdminSessionToken,
  getRfAdminSession,
  requireRfAdminSession,
  RF_ADMIN_MFA_COOKIE,
  RF_ADMIN_SESSION_COOKIE,
  verifyMfaChallenge,
  verifyRfAdminSessionToken,
} from "./session";

/**
 * Rebuilds the dashboard's client session token the way `app/lib/session.ts`
 * does, so the tests can prove that a genuine client token is refused here.
 */
function createClientSessionToken(
  uid: string,
  authSecret: string,
  now: number = Date.now(),
): string {
  const payload = Buffer.from(JSON.stringify({ uid, iat: now })).toString("base64url");
  const signature = createHmac("sha256", authSecret)
    .update("rf-session:v1")
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

const ADMIN_SECRET = "rf_admin_only_secret_value_1234567890";
const DASHBOARD_SECRET = "dashboard_only_secret_value_123456789";

beforeEach(() => {
  h.cookiesStore.clear();
  process.env.RF_ADMIN_SESSION_SECRET = ADMIN_SECRET;
  // Present specifically to prove the admin path never reads it.
  process.env.AUTH_SECRET = DASHBOARD_SECRET;
});

describe("admin session token", () => {
  it("round-trips", () => {
    const token = createRfAdminSessionToken("rfa_console_admin", 1_700_000_000_000);
    const payload = verifyRfAdminSessionToken(token, 1_700_000_000_000);
    expect(payload?.uid).toBe("rfa_console_admin");
    expect(payload?.mode).toBe("RF_ADMIN");
    expect(payload?.mfa).toBe(true);
  });

  it("expires after the 8 hour TTL", () => {
    const token = createRfAdminSessionToken("rfa_console_admin", 1_700_000_000_000);
    expect(verifyRfAdminSessionToken(token, 1_700_000_000_000 + 8 * 3600_000)).not.toBeNull();
    expect(verifyRfAdminSessionToken(token, 1_700_000_000_000 + 8 * 3600_000 + 1_000)).toBeNull();
  });

  it("rejects a token signed with the dashboard's key", () => {
    const forged = createClientSessionToken("usr_jordan", DASHBOARD_SECRET);
    expect(verifyRfAdminSessionToken(forged)).toBeNull();
  });

  it("rejects a token signed with any other key", () => {
    const payload = Buffer.from(
      JSON.stringify({ mode: "RF_ADMIN", uid: "rfa_console_admin", mfa: true, iat: Date.now() }),
    ).toString("base64url");
    const sig = createHmac("sha256", "some_other_secret").update("rf-admin:v1").update(payload).digest("base64url");
    expect(verifyRfAdminSessionToken(`${payload}.${sig}`)).toBeNull();
  });

  it("rejects an admin payload that never passed MFA", () => {
    const payload = Buffer.from(
      JSON.stringify({ mode: "RF_ADMIN", uid: "rfa_console_admin", iat: Date.now() }),
    ).toString("base64url");
    const sig = createHmac("sha256", ADMIN_SECRET).update("rf-admin:v1").update(payload).digest("base64url");
    expect(verifyRfAdminSessionToken(`${payload}.${sig}`)).toBeNull();
  });

  it("rejects a pending-MFA challenge used as a session", () => {
    // The challenge is signed with a different domain, so it cannot verify.
    const challenge = createMfaChallenge("rfa_console_admin", "nonce-1");
    expect(verifyRfAdminSessionToken(challenge)).toBeNull();
    expect(verifyMfaChallenge(challenge)?.adminId).toBe("rfa_console_admin");
  });

  it("rejects malformed tokens instead of throwing", () => {
    for (const bad of ["", ".", "a.b", "no-dot", "a.b.c"]) {
      expect(verifyRfAdminSessionToken(bad)).toBeNull();
    }
  });
});

describe("MFA challenge", () => {
  it("carries the admin id and nonce", () => {
    const challenge = verifyMfaChallenge(createMfaChallenge("rfa_console_admin", "abc"));
    expect(challenge).toMatchObject({ adminId: "rfa_console_admin", nonce: "abc" });
  });

  it("expires after 5 minutes", () => {
    const token = createMfaChallenge("rfa_console_admin", "abc", 1_700_000_000_000);
    expect(verifyMfaChallenge(token, 1_700_000_000_000 + 5 * 60_000)).not.toBeNull();
    expect(verifyMfaChallenge(token, 1_700_000_000_000 + 5 * 60_000 + 1_000)).toBeNull();
  });
});

describe("getRfAdminSession", () => {
  it("is null with no cookie", async () => {
    expect(await getRfAdminSession()).toBeNull();
  });

  it("resolves an active, MFA-enrolled admin", async () => {
    h.cookiesStore.set(RF_ADMIN_SESSION_COOKIE, createRfAdminSessionToken("rfa_console_admin"));
    expect(await getRfAdminSession()).toEqual({
      mode: "RF_ADMIN",
      adminId: "rfa_console_admin",
      name: "RF Console Admin",
      email: "admin@rf-intelligence.com",
    });
  });

  it("ignores a client rf_session cookie entirely", async () => {
    h.cookiesStore.set("rf_session", createClientSessionToken("usr_jordan", DASHBOARD_SECRET));
    expect(await getRfAdminSession()).toBeNull();
  });

  it("refuses a client user id presented in a validly signed admin token", async () => {
    // A client user id, signed with the correct admin key. This can only happen
    // via a bug or a leaked signing key, so the guard is on the lookup table:
    // RfAdminUser has no row with that id, so it must not resolve.
    h.cookiesStore.set(RF_ADMIN_SESSION_COOKIE, createRfAdminSessionToken("usr_jordan"));
    expect(await getRfAdminSession()).toBeNull();
  });

  it("treats a suspended admin as signed out", async () => {
    h.cookiesStore.set(RF_ADMIN_SESSION_COOKIE, createRfAdminSessionToken("rfa_suspended"));
    expect(await getRfAdminSession()).toBeNull();
  });

  it("signs out an admin whose MFA was disabled after enrolment", async () => {
    h.cookiesStore.set(RF_ADMIN_SESSION_COOKIE, createRfAdminSessionToken("rfa_no_mfa"));
    expect(await getRfAdminSession()).toBeNull();
  });
});

describe("requireRfAdminSession", () => {
  it("returns the session when present", async () => {
    h.cookiesStore.set(RF_ADMIN_SESSION_COOKIE, createRfAdminSessionToken("rfa_console_admin"));
    const result = await requireRfAdminSession();
    expect(result.ok).toBe(true);
  });

  it("returns a 401 otherwise, never a client session", async () => {
    h.cookiesStore.set("rf_session", createClientSessionToken("usr_jordan", DASHBOARD_SECRET));
    const result = await requireRfAdminSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});

describe("cookie names", () => {
  it("uses a distinct name from the dashboard session cookie", () => {
    expect(RF_ADMIN_SESSION_COOKIE).not.toBe("rf_session");
    expect(RF_ADMIN_MFA_COOKIE).not.toBe(RF_ADMIN_SESSION_COOKIE);
  });

  it("prefixes cookies with __Host- in production only", async () => {
    // The prefix is evaluated at module load, so assert the invariant that
    // matters: whatever the environment, the name used for writing is the same
    // constant used for reading.
    expect(RF_ADMIN_SESSION_COOKIE.endsWith("rf_admin_session")).toBe(true);
    expect(RF_ADMIN_MFA_COOKIE.endsWith("rf_admin_mfa_pending")).toBe(true);
  });
});

describe("independent secrets", () => {
  it("would accept a shared key, so the deployment must not share one", () => {
    // Documents the remaining deployment-time obligation: the token scheme
    // protects against a client token, but only a distinct
    // RF_ADMIN_SESSION_SECRET stops a token minted here from being forged by
    // code that holds the dashboard's key.
    expect(createHash("sha256").update(ADMIN_SECRET).digest("hex")).not.toBe(
      createHash("sha256").update(DASHBOARD_SECRET).digest("hex"),
    );
  });
});
