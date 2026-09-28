import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const VALID_KEY = randomBytes(32).toString("base64");

describe("secret encryption at rest", () => {
  beforeEach(() => {
    process.env.RF_ADMIN_MFA_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.RF_ADMIN_MFA_ENCRYPTION_KEY;
  });

  it("round-trips a TOTP secret", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("round-trips non-ASCII plaintext", () => {
    const value = "contraseña — 秘密 🔐";
    expect(decryptSecret(encryptSecret(value))).toBe(value);
  });

  it("never emits the plaintext into the stored value", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(Buffer.from(stored, "base64").toString("utf8")).not.toContain(secret);
  });

  it("uses a fresh IV for every encryption, so the same secret stores differently", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const values = new Set(Array.from({ length: 50 }, () => encryptSecret(secret)));
    expect(values.size).toBe(50);
    for (const value of values) {
      expect(decryptSecret(value)).toBe(secret);
    }
  });

  it("returns null when the ciphertext is tampered with (GCM auth tag)", () => {
    const stored = Buffer.from(encryptSecret("JBSWY3DPEHPK3PXP"), "base64");
    // Flip a bit in the ciphertext body, leaving IV and tag intact.
    stored[stored.length - 1] ^= 0x01;
    expect(decryptSecret(stored.toString("base64"))).toBeNull();
  });

  it("returns null when the IV is tampered with", () => {
    const stored = Buffer.from(encryptSecret("JBSWY3DPEHPK3PXP"), "base64");
    stored[1] ^= 0x01;
    expect(decryptSecret(stored.toString("base64"))).toBeNull();
  });

  it("returns null when the auth tag is tampered with", () => {
    const stored = Buffer.from(encryptSecret("JBSWY3DPEHPK3PXP"), "base64");
    stored[13] ^= 0x01;
    expect(decryptSecret(stored.toString("base64"))).toBeNull();
  });

  it("returns null under a different key", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP");
    process.env.RF_ADMIN_MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(decryptSecret(stored)).toBeNull();
  });

  it("returns null for an unknown format version rather than guessing", () => {
    const stored = Buffer.from(encryptSecret("JBSWY3DPEHPK3PXP"), "base64");
    stored[0] = 99;
    expect(decryptSecret(stored.toString("base64"))).toBeNull();
  });

  it("returns null for empty, absent, or truncated input", () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret("")).toBeNull();
    expect(decryptSecret(Buffer.alloc(10).toString("base64"))).toBeNull();
    expect(decryptSecret(Buffer.from([1]).toString("base64"))).toBeNull();
  });
});

describe("key configuration", () => {
  afterEach(() => {
    delete process.env.RF_ADMIN_MFA_ENCRYPTION_KEY;
  });

  it("throws when the key is missing", () => {
    delete process.env.RF_ADMIN_MFA_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/not configured/);
  });

  it("throws when the key is not 32 bytes", () => {
    process.env.RF_ADMIN_MFA_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });

  it("gives an actionable message for a non-base64 key", () => {
    process.env.RF_ADMIN_MFA_ENCRYPTION_KEY = "not base64 at all!!";
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
