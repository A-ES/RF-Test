import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, createIpMatcher, isIpAllowed } from "./ip-allowlist";

describe("createIpMatcher", () => {
  it("returns null when the allowlist is unset or empty", () => {
    expect(createIpMatcher(undefined)).toBeNull();
    expect(createIpMatcher("")).toBeNull();
    expect(createIpMatcher("  ,  ,")).toBeNull();
  });

  it("matches an exact address", () => {
    const match = createIpMatcher("203.0.113.7, 198.51.100.4")!;
    expect(match("203.0.113.7")).toBe(true);
    expect(match("198.51.100.4")).toBe(true);
    expect(match("203.0.113.8")).toBe(false);
  });

  it("matches a CIDR range and excludes neighbours", () => {
    const match = createIpMatcher("10.0.0.0/8")!;
    expect(match("10.0.0.1")).toBe(true);
    expect(match("10.255.255.255")).toBe(true);
    expect(match("11.0.0.1")).toBe(false);
  });

  it("supports a single-host /32 and a full /0", () => {
    expect(createIpMatcher("203.0.113.5/32")!("203.0.113.5")).toBe(true);
    expect(createIpMatcher("203.0.113.5/32")!("203.0.113.6")).toBe(false);
    const any = createIpMatcher("0.0.0.0/0")!;
    expect(any("1.2.3.4")).toBe(true);
    expect(any("255.255.255.255")).toBe(true);
  });

  it("tolerates whitespace and mixed entries", () => {
    const match = createIpMatcher("  10.0.0.0/8 , 203.0.113.7  ")!;
    expect(match("10.1.2.3")).toBe(true);
    expect(match("203.0.113.7")).toBe(true);
    expect(match("192.0.2.1")).toBe(false);
  });

  it("normalises IPv6-mapped IPv4 addresses", () => {
    const match = createIpMatcher("203.0.113.7")!;
    expect(match("::ffff:203.0.113.7")).toBe(true);
  });

  it("rejects malformed addresses and CIDRs rather than matching everything", () => {
    const match = createIpMatcher("10.0.0.0/8, not-an-ip, 10.0.0.0/99, 300.1.1.1")!;
    expect(match("10.1.1.1")).toBe(true);
    expect(match("not-an-ip")).toBe(false);
    expect(match("300.1.1.1")).toBe(false);
    expect(match(null)).toBe(false);
  });
});

describe("isIpAllowed", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  // NODE_ENV is typed readonly, but the fail-closed behaviour is exactly what
  // we need to exercise, so override it through a cast.
  function setNodeEnv(value: string) {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  }

  it("denies everything in production when unset", () => {
    setNodeEnv("production");
    expect(isIpAllowed("10.0.0.1", undefined)).toBe(false);
    expect(isIpAllowed("10.0.0.1", "")).toBe(false);
  });

  it("denies a non-allowlisted address in production even when configured", () => {
    setNodeEnv("production");
    expect(isIpAllowed("8.8.8.8", "203.0.113.0/24")).toBe(false);
    expect(isIpAllowed("203.0.113.9", "203.0.113.0/24")).toBe(true);
  });

  it("allows localhost in development when unset", () => {
    setNodeEnv("development");
    expect(isIpAllowed("127.0.0.1", undefined)).toBe(true);
  });

  it("still enforces the list in development when it is set", () => {
    setNodeEnv("development");
    expect(isIpAllowed("8.8.8.8", "203.0.113.0/24")).toBe(false);
  });

  it("restores NODE_ENV", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers the Vercel header", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "8.8.8.8",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("takes the left-most entry of a forwarded chain", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then null", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});
