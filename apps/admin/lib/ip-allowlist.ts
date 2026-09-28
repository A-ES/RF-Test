/**
 * IP allowlist for the RF Admin console.
 *
 * This is the outermost of the app's controls — it runs in `proxy.ts` before
 * any route handler, so a request from a non-allowlisted address never
 * reaches a login form, let alone the database.
 *
 * Two deliberate design decisions:
 *
 *   1. **Fail closed.** In production an unset or empty allowlist denies every
 *      request. An accidentally-missing env var must not silently open the
 *      cross-tenant console to the internet. Development is the only exception,
 *      so `pnpm dev` works without ceremony.
 *   2. **Proxy-level, not route-level.** Next.js 16 runs `proxy.ts` on every
 *      request before routing, which is the right place for a blanket network
 *      check, and it is cheap because it touches no database.
 *
 * Trusting `x-forwarded-for` is only sound because the app is fronted by Vercel,
 * which overwrites that header. If this app is ever exposed directly, that
 * header becomes attacker-controlled and the allowlist must move to a proxy
 * rule instead. See docs/ADMIN_APP.md.
 */

/** Parses the allowlist into a matcher; returns null when nothing is allowed. */
export function createIpMatcher(rawAllowlist: string | undefined) {
  const entries = (rawAllowlist ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (entries.length === 0) return null;

  const exact = new Set<string>();
  const ranges: { base: number; mask: number }[] = [];

  for (const entry of entries) {
    const cidr = parseCidr(entry);
    if (cidr) {
      ranges.push(cidr);
      continue;
    }
    // A malformed entry must be dropped, not stored verbatim. Storing it would
    // make a typo like "not-an-ip" a literal string that happens to match
    // nothing today but silently fails open the day someone "fixes" it.
    if (isValidIp(entry)) {
      exact.add(normalizeIp(entry));
    }
  }

  return (ip: string | null): boolean => {
    if (!ip) return false;
    const candidate = normalizeIp(ip);
    if (exact.has(candidate)) return true;
    const value = ipv4ToInt(candidate);
    if (value === null) return false;
    return ranges.some(({ base, mask }) => (value & mask) === (base & mask));
  };
}

function normalizeIp(ip: string): string {
  // Strip an IPv6-mapped IPv4 prefix (::ffff:1.2.3.4) so both forms compare equal.
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Accepts dotted-quad IPv4, with or without an IPv6-mapped prefix. */
function isValidIp(ip: string): boolean {
  return ipv4ToInt(normalizeIp(ip)) !== null;
}

function parseCidr(entry: string): { base: number; mask: number } | null {
  const [network, prefixRaw] = entry.split("/");
  const base = ipv4ToInt(normalizeIp(network ?? ""));
  if (base === null || prefixRaw === undefined) return null;

  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  // A /32 is an exact single host; represent it as a full-width mask so the
  // comparison below stays a single code path.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base, mask };
}

/** True when the request should be allowed to proceed. */
export function isIpAllowed(requestIp: string | null, allowlist: string | undefined): boolean {
  const matcher = createIpMatcher(allowlist);
  if (!matcher) {
    // Fail closed everywhere except development.
    return process.env.NODE_ENV !== "production";
  }
  return matcher(requestIp);
}

/**
 * Extracts the client IP. Vercel sets `x-vercel-forwarded-for` (and also
 * `x-forwarded-for`); we prefer the Vercel-specific header.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-forwarded-for"),
    headers.get("x-real-ip"),
  ];
  for (const header of candidates) {
    if (!header) continue;
    // x-forwarded-for can be a chain; the left-most entry is the original client.
    const first = header.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}
