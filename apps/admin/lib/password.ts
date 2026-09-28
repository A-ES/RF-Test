import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for RF admin accounts.
 *
 * The dashboard's client login uses a bare SHA-256 digest because no
 * password-hashing library is installed in this repo. That is acceptable for
 * the existing `User` table, which is out of scope here, but this is the
 * cross-tenant privilege path and a fast digest is exactly the wrong primitive
 * for it. Node's built-in `scrypt` is a memory-hard KDF and needs no new
 * dependency, so the admin console uses it instead.
 *
 * Stored format: `scrypt$N$r$p$<salt base64>$<derived key base64>`
 * so the parameters travel with the hash and can be raised later without
 * invalidating existing credentials.
 *
 * Legacy bare-SHA-256 hex digests are still *accepted* (the previous seed wrote
 * them) and transparently upgraded on the next successful login.
 */

type ScryptOptions = { N: number; r: number; p: number };

/**
 * `promisify(scrypt)` resolves to the 3-argument overload, which drops the
 * options object. Re-wrap so the cost parameters are always applied — silently
 * losing N/r/p here would make every hash use Node's defaults.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const SCRYPT_PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
  });
  return [
    SCRYPT_PREFIX,
    N,
    R,
    P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export function isLegacySha256Hash(stored: string): boolean {
  return /^[0-9a-f]{64}$/.test(stored);
}

function legacySha256(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies a password against a stored hash, accepting both the scrypt format
 * and the legacy SHA-256 hex digest.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  const candidate = password.normalize("NFKC");

  if (isLegacySha256Hash(stored)) {
    const expected = Buffer.from(stored, "hex");
    const actual = Buffer.from(legacySha256(candidate), "hex");
    return {
      valid: safeEqual(expected, actual),
      // Signal the caller to rewrite the row in the stronger format.
      needsRehash: true,
    };
  }

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) {
    return { valid: false, needsRehash: false };
  }

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return { valid: false, needsRehash: false };
  }

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (salt.length === 0 || expected.length === 0) {
    return { valid: false, needsRehash: false };
  }

  const actual = await scryptAsync(candidate, salt, expected.length, { N: n, r, p });

  const valid = safeEqual(expected, actual);
  return { valid, needsRehash: valid && (n < N || r < R || p < P) };
}
