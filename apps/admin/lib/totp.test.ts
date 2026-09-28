import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpAt,
  totpCounter,
  verifyTotp,
} from "./totp";

/** RFC 4226 Appendix D — HOTP test vectors for the ASCII secret "12345678901234567890". */
const RFC4226_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const RFC4226_VECTORS: [counter: number, expected: string][] = [
  [0, "755224"],
  [1, "287082"],
  [2, "359152"],
  [3, "969429"],
  [4, "338314"],
  [5, "254676"],
  [6, "287922"],
  [7, "162583"],
  [8, "399871"],
  [9, "520489"],
];

/** RFC 6238 Appendix B — SHA-1 rows. */
const RFC6238_VECTORS: [timeSeconds: number, expected: string][] = [
  [59, "94287082"], // 8 digits; we use 6, so compared against hotp(..., 4) below
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f, 0x01]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it("matches the RFC 4648 test vectors", () => {
    expect(base32Encode(Buffer.from("f", "ascii"))).toBe("MY");
    expect(base32Encode(Buffer.from("fo", "ascii"))).toBe("MZXQ");
    expect(base32Encode(Buffer.from("foo", "ascii"))).toBe("MZXW6");
    expect(base32Encode(Buffer.from("foob", "ascii"))).toBe("MZXW6YQ");
    expect(base32Encode(Buffer.from("fooba", "ascii"))).toBe("MZXW6YTB");
    expect(base32Encode(Buffer.from("foobar", "ascii"))).toBe("MZXW6YTBOI");
  });

  it("tolerates whitespace and dashes in a pasted secret", () => {
    const encoded = base32Encode(Buffer.from("secretvalue1234", "ascii"));
    const spaced = encoded.split("").join("-");
    expect(base32Decode(spaced).equals(base32Decode(encoded))).toBe(true);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("ABC1DEF")).toThrow(/Invalid base32/);
  });
});

describe("HOTP (RFC 4226 Appendix D)", () => {
  it.each(RFC4226_VECTORS)("counter %i -> %s", (counter, expected) => {
    expect(hotp(base32Decode(RFC4226_SECRET), counter)).toBe(expected);
  });
});

describe("TOTP (RFC 6238 Appendix B)", () => {
  it("derives the expected counter from the time", () => {
    expect(totpCounter(59 * 1000)).toBe(1);
    expect(totpCounter(1_111_111_109_000)).toBe(37037036);
  });

  it("reproduces the RFC's 8-digit codes at 8 digits", () => {
    // The spec's vectors are 8 digits; verifying at that width proves the
    // dynamic-truncation implementation rather than just the modulo.
    for (const [timeSeconds, expected] of RFC6238_VECTORS) {
      const counter = Math.floor(timeSeconds / 30);
      expect(hotp(base32Decode(RFC4226_SECRET), counter, 8)).toBe(expected);
    }
  });

  it("reproduces the RFC's codes as the 6-digit codes we actually accept", () => {
    // 6 digits are the last six of the 8-digit vector.
    for (const [timeSeconds, expected] of RFC6238_VECTORS) {
      const counter = Math.floor(timeSeconds / 30);
      expect(hotp(base32Decode(RFC4226_SECRET), counter, 6)).toBe(expected.slice(-6));
    }
  });

  it("agrees with the top-level helper", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(totpAt(secret, now)).toBe(hotp(base32Decode(secret), totpCounter(now)));
  });
});

describe("verifyTotp", () => {
  const secret = generateTotpSecret();

  it("accepts the code for the current step", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now), now).valid).toBe(true);
  });

  it("accepts codes one step either side for clock drift", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now).valid).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), now).valid).toBe(true);
  });

  it("rejects codes beyond the drift window", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now - 120_000), now).valid).toBe(false);
    expect(verifyTotp(secret, totpAt(secret, now + 120_000), now).valid).toBe(false);
  });

  it("reports the matching counter so the caller can block replay", () => {
    const now = 1_700_000_000_000;
    const result = verifyTotp(secret, totpAt(secret, now - 30_000), now);
    expect(result.valid).toBe(true);
    expect(result.counter).toBe(totpCounter(now - 30_000));
  });

  it("rejects malformed input without throwing", () => {
    const now = 1_700_000_000_000;
    for (const bad of ["", "abc", "12345", "1234567", "12345a", "  "]) {
      expect(verifyTotp(secret, bad, now).valid).toBe(false);
    }
  });

  it("tolerates the spaces users paste from their authenticator", () => {
    const now = 1_700_000_000_000;
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now).valid).toBe(true);
  });

  it("rejects an unusable secret", () => {
    expect(verifyTotp("!!!", "123456", 0).valid).toBe(false);
    expect(verifyTotp("", "123456", 0).valid).toBe(false);
  });
});

describe("otpauthUri", () => {
  it("produces a scannable provisioning URI", () => {
    const uri = otpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "a@b.com", issuer: "RF Intelligence" });
    expect(uri.startsWith("otpauth://totp/RF%20Intelligence:a%40b.com?")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=RF+Intelligence");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
