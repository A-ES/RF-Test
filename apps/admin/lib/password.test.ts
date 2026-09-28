import { createHash, randomBytes, scrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, isLegacySha256Hash, verifyPassword } from "./password";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

describe("hashPassword", () => {
  it("produces a self-describing scrypt hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const parts = hash.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toBe("16384");
    expect(parts[2]).toBe("8");
    expect(parts[3]).toBe("1");
  });

  it("never stores the password or a bare digest of it", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
    expect(hash).not.toContain(createHash("sha256").update(password).digest("hex"));
    expect(isLegacySha256Hash(hash)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toEqual({ valid: true, needsRehash: false });
    expect(await verifyPassword("same-password", b)).toEqual({ valid: true, needsRehash: false });
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("s3cret-password");
    expect((await verifyPassword("s3cret-password", hash)).valid).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-password");
    expect((await verifyPassword("s3cret-passwore", hash)).valid).toBe(false);
    expect((await verifyPassword("", hash)).valid).toBe(false);
  });

  it("normalises unicode so equivalent inputs match", async () => {
    // "é" as one code point vs "e" + combining acute.
    const composed = "caf\u00e9-pass";
    const decomposed = "cafe\u0301-pass";
    const hash = await hashPassword(composed);
    expect((await verifyPassword(decomposed, hash)).valid).toBe(true);
  });

  it("accepts a legacy SHA-256 digest and asks for an upgrade", async () => {
    const legacy = createHash("sha256").update("legacy-password").digest("hex");
    expect(isLegacySha256Hash(legacy)).toBe(true);
    expect(await verifyPassword("legacy-password", legacy)).toEqual({
      valid: true,
      needsRehash: true,
    });
    expect((await verifyPassword("wrong", legacy)).valid).toBe(false);
  });

  it("flags a hash written with weaker parameters for rehash", async () => {
    // Build a genuine low-cost hash: the salt/key must actually be derived with
    // the weaker parameters, otherwise the stored N no longer matches the key
    // and the hash simply fails to verify.
    const salt = randomBytes(16);
    const weak = await scryptAsync("pw", salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = ["scrypt", 1024, 8, 1, salt.toString("base64"), weak.toString("base64")].join("$");

    expect(await verifyPassword("pw", stored)).toEqual({ valid: true, needsRehash: true });
  });

  it("rejects unparseable stored hashes instead of throwing", async () => {
    for (const bad of ["", "notahash", "scrypt$$$$", "bcrypt$1$2$3$4$5", "scrypt$x$y$z$a$b"]) {
      expect((await verifyPassword("pw", bad)).valid).toBe(false);
    }
  });
});
