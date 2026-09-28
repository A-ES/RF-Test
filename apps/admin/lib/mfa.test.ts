import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN_ID = "rfa_console_admin";

const h = vi.hoisted(() => {
  const state = {
    // Keyed by id so the mock can answer `where.id` lookups faithfully, the way
    // Prisma does. A single mutable row object would go stale against the
    // reassignment in beforeEach.
    admins: new Map<string, Record<string, unknown>>(),
  };
  return { state };
});

vi.mock("@rf-intelligence/db", () => ({
  prisma: {
    rfAdminUser: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const row = h.state.admins.get(args.where.id);
        return row ? { ...row } : null;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = h.state.admins.get(args.where.id);
        if (!row) throw new Error(`no such admin ${args.where.id}`);
        Object.assign(row, args.data);
        return { ...row };
      }),
    },
  },
}));

import { encryptSecret } from "./crypto";
import { completeMfaChallenge } from "./mfa";
import { createMfaChallenge, MFA_LOCKOUT_SECONDS, MFA_MAX_FAILED_ATTEMPTS, verifyMfaChallenge } from "./session";
import { generateTotpSecret, totpAt } from "./totp";

const TEST_KEY = randomBytes(32).toString("base64");

// Both keys are read eagerly by the modules under test, and CHALLENGE is signed
// at module scope below, so these are set before anything else runs.
process.env.RF_ADMIN_MFA_ENCRYPTION_KEY = TEST_KEY;
process.env.RF_ADMIN_SESSION_SECRET = "rf_admin_only_secret_value_1234567890";

const SECRET = generateTotpSecret();
const NOW = 1_700_000_000_000;
/**
 * completeMfaChallenge takes a *decoded* challenge, which in production comes
 * from getMfaChallenge() (cookie -> verifyMfaChallenge). createMfaChallenge
 * returns a signed string, so decode it here to match that call path.
 */
function challengeFor(adminId: string, now: number) {
  const decoded = verifyMfaChallenge(createMfaChallenge(adminId, "nonce-1", now), now);
  if (!decoded) throw new Error("challenge failed to verify");
  return decoded;
}

const CHALLENGE = challengeFor(ADMIN_ID, NOW);

function codeAt(offsetMs = 0): string {
  return totpAt(SECRET, NOW + offsetMs);
}

beforeEach(() => {
  h.state.admins.clear();
  h.state.admins.set(ADMIN_ID, {
    id: ADMIN_ID,
    isActive: true,
    mfaEnabled: true,
    mfaSecretCiphertext: encryptSecret(SECRET),
    mfaFailedAttempts: 0,
    mfaLockedUntil: null,
    mfaLastUsedStep: null,
  });
});

/** The single mutable row under test. */
function admin(): Record<string, unknown> {
  return h.state.admins.get(ADMIN_ID) as Record<string, unknown>;
}

describe("completeMfaChallenge — success", () => {
  it("accepts a valid code and records the spent step", async () => {
    const result = await completeMfaChallenge(CHALLENGE, codeAt(), NOW);
    expect(result).toEqual({ status: "ok", adminId: "rfa_console_admin" });
    expect(admin().mfaFailedAttempts).toBe(0);
    expect(admin().mfaLastUsedStep).toBeGreaterThan(0);
  });

  it("accepts a code from the next step (clock drift ahead)", async () => {
    expect((await completeMfaChallenge(CHALLENGE, codeAt(30_000), NOW)).status).toBe("ok");
  });

  it("clears a previous lockout on success", async () => {
    admin().mfaLockedUntil = new Date(NOW - 1000); // expired
    admin().mfaFailedAttempts = 3;
    expect((await completeMfaChallenge(CHALLENGE, codeAt(), NOW)).status).toBe("ok");
    expect(admin().mfaFailedAttempts).toBe(0);
    expect(admin().mfaLockedUntil).toBeNull();
  });
});

describe("completeMfaChallenge — wrong codes", () => {
  it("counts failures and reports an invalid code", async () => {
    expect((await completeMfaChallenge(CHALLENGE, "000000", NOW)).status).toBe("invalid_code");
    expect(admin().mfaFailedAttempts).toBe(1);
  });

  it("locks out on the final attempt and resets the counter", async () => {
    for (let i = 1; i < MFA_MAX_FAILED_ATTEMPTS; i += 1) {
      expect((await completeMfaChallenge(CHALLENGE, "000000", NOW)).status).toBe("invalid_code");
    }
    const result = await completeMfaChallenge(CHALLENGE, "000000", NOW);
    expect(result).toEqual({ status: "locked_out", retryAfterSeconds: MFA_LOCKOUT_SECONDS });
    expect(admin().mfaFailedAttempts).toBe(0);
    expect(admin().mfaLockedUntil).toBeInstanceOf(Date);
  });

  it("refuses even the correct code while locked out", async () => {
    admin().mfaLockedUntil = new Date(NOW + MFA_LOCKOUT_SECONDS * 1000);
    const result = await completeMfaChallenge(CHALLENGE, codeAt(), NOW);
    expect(result).toEqual({
      status: "locked_out",
      retryAfterSeconds: MFA_LOCKOUT_SECONDS,
    });
  });

  it("reports a shrinking retry window as the lockout ages", async () => {
    admin().mfaLockedUntil = new Date(NOW + 60_000);
    const result = await completeMfaChallenge(CHALLENGE, codeAt(), NOW);
    expect(result).toEqual({ status: "locked_out", retryAfterSeconds: 60 });
  });
});

describe("completeMfaChallenge — replay", () => {
  it("refuses a code whose step was already spent", async () => {
    const code = codeAt();
    expect((await completeMfaChallenge(CHALLENGE, code, NOW)).status).toBe("ok");

    // Same six digits, still inside the same 30-second window.
    const replay = await completeMfaChallenge(CHALLENGE, code, NOW + 5_000);
    expect(replay.status).toBe("replayed");
  });

  it("refuses an older step even when a newer one is presented later", async () => {
    // Burn the current step, then wait for a new one, then try the old digits.
    const oldCode = codeAt();
    expect((await completeMfaChallenge(CHALLENGE, oldCode, NOW)).status).toBe("ok");

    const later = NOW + 30_000;
    expect((await completeMfaChallenge(CHALLENGE, codeAt(30_000), later)).status).toBe("ok");

    // The original code's step is now two behind the last spent step.
    expect((await completeMfaChallenge(CHALLENGE, oldCode, later)).status).toBe("replayed");
  });

  it("still accepts a strictly newer step after a replay attempt", async () => {
    const code = codeAt();
    await completeMfaChallenge(CHALLENGE, code, NOW);
    await completeMfaChallenge(CHALLENGE, code, NOW);

    const next = NOW + 30_000;
    expect((await completeMfaChallenge(CHALLENGE, codeAt(30_000), next)).status).toBe("ok");
  });
});

describe("completeMfaChallenge — unusable accounts", () => {
  it("refuses an admin with MFA disabled", async () => {
    admin().mfaEnabled = false;
    expect((await completeMfaChallenge(CHALLENGE, codeAt(), NOW)).status).toBe("not_enrolled");
  });

  it("refuses an admin with no stored secret", async () => {
    admin().mfaSecretCiphertext = null;
    expect((await completeMfaChallenge(CHALLENGE, codeAt(), NOW)).status).toBe("not_enrolled");
  });

  it("refuses when the stored secret cannot be decrypted (wrong key)", async () => {
    admin().mfaSecretCiphertext = encryptSecret(SECRET);
    process.env.RF_ADMIN_MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    try {
      expect((await completeMfaChallenge(CHALLENGE, codeAt(), NOW)).status).toBe("not_enrolled");
    } finally {
      process.env.RF_ADMIN_MFA_ENCRYPTION_KEY = TEST_KEY;
    }
  });

  it("refuses a deactivated admin", async () => {
    admin().isActive = false;
    expect((await completeMfaChallenge(CHALLENGE, codeAt(), NOW)).status).toBe("challenge_mismatch");
  });

  it("refuses an unknown admin id", async () => {
    const unknown = challengeFor("rfa_does_not_exist", NOW);
    expect((await completeMfaChallenge(unknown, codeAt(), NOW)).status).toBe("challenge_mismatch");
  });
});
