import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for TOTP secrets at rest.
 *
 * A TOTP secret cannot be hashed — the server has to recompute the expected
 * code — so it is stored reversibly. This is the one place in the codebase that
 * holds a key capable of recovering a second factor, so:
 *
 *   • the key lives only in RF_ADMIN_MFA_ENCRYPTION_KEY, never in the database;
 *   • GCM gives us integrity as well as confidentiality, so a tampered
 *     ciphertext fails to open instead of yielding a garbage secret;
 *   • the random 12-byte IV is stored alongside the ciphertext and is never
 *     reused across encryptions.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;

/** Ciphertext layout: version byte | 12-byte IV | 16-byte tag | ciphertext. */
const VERSION = 1;

function getKey(): Buffer {
  const raw = process.env.RF_ADMIN_MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("RF_ADMIN_MFA_ENCRYPTION_KEY is not configured");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `RF_ADMIN_MFA_ENCRYPTION_KEY must be ${KEY_BYTES} bytes base64-encoded (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]).toString("base64");
}

/**
 * Decrypts a stored secret. Returns null rather than throwing when the payload
 * is malformed, wrong-keyed, or tampered — callers treat all three the same way
 * (MFA cannot be satisfied), so there is no information to leak.
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    return null;
  }
  if (buffer.length < 1 + IV_BYTES + AUTH_TAG_BYTES) return null;
  if (buffer[0] !== VERSION) return null;

  const iv = buffer.subarray(1, 1 + IV_BYTES);
  const tag = buffer.subarray(1 + IV_BYTES, 1 + IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buffer.subarray(1 + IV_BYTES + AUTH_TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
