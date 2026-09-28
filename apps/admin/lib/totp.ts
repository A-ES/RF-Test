import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), HMAC-SHA1, 6 digits, 30-second step.
 *
 * Implemented directly rather than pulled from a dependency: the repo has no
 * auth library installed, and this is the whole surface an MFA factor needs.
 * Correctness is pinned by the RFC 6238 Appendix B test vectors in
 * totp.test.ts — do not "simplify" this without re-running them.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** SHA-1 block size, the counter width HOTP hashes over. */
const COUNTER_BYTES = 8;

/** How many steps either side of "now" are accepted, to absorb clock drift. */
export const TOTP_WINDOW = 1;

export function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = input.replace(/[\s-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The TOTP counter (time-step number) for a point in time. */
export function totpCounter(
  timestampMs: number,
  stepSeconds: number = TOTP_STEP_SECONDS,
): number {
  return Math.floor(timestampMs / 1000 / stepSeconds);
}

/** HOTP: the RFC 4226 one-time password for a given counter value. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const counterBuffer = Buffer.alloc(COUNTER_BYTES);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", secret).update(counterBuffer).digest();
  // Dynamic truncation (RFC 4226 §5.4).
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function generateTotpSecret(bytes: number = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function totpAt(secretBase32: string, timestampMs: number): string {
  return hotp(base32Decode(secretBase32), totpCounter(timestampMs));
}

export interface TotpVerification {
  valid: boolean;
  /** The counter that matched, so the caller can refuse to replay it. */
  counter: number | null;
}

/**
 * Verifies a submitted code against the secret, allowing +/- TOTP_WINDOW steps
 * for clock drift. Constant-time comparison against every candidate step.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  timestampMs: number = Date.now(),
  window: number = TOTP_WINDOW,
): TotpVerification {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d+$/.test(normalized) || normalized.length !== TOTP_DIGITS) {
    return { valid: false, counter: null };
  }

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return { valid: false, counter: null };
  }
  if (secret.length === 0) return { valid: false, counter: null };

  const current = totpCounter(timestampMs);
  const submitted = Buffer.from(normalized, "utf8");

  // Walk every candidate step, comparing each, so the work does not depend on
  // which step matches.
  let matched: number | null = null;
  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = current + drift;
    if (candidate < 0) continue;
    const expected = Buffer.from(hotp(secret, candidate), "utf8");
    if (expected.length === submitted.length && timingSafeEqual(expected, submitted)) {
      matched = candidate;
    }
  }

  return { valid: matched !== null, counter: matched };
}

/** The otpauth:// URI an authenticator app scans. */
export function otpauthUri(params: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
