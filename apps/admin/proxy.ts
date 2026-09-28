import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders, isIpAllowed } from "./lib/ip-allowlist";

/**
 * Network boundary for the RF Admin console.
 *
 * In Next.js 16 this file convention is `proxy.ts` (middleware was renamed),
 * it runs on the Node.js runtime, and it executes before any route renders — so
 * this is the right place for a blanket check that must apply to every
 * response, including static assets, redirects and 404s.
 *
 * Two things happen here, both cheap and both touching no database:
 *
 *   1. The IP allowlist. A request from a non-allowlisted address is rejected
 *      before it reaches a login form. This fails closed: with no
 *      ADMIN_IP_ALLOWLIST set in production, every request is refused.
 *   2. noindex on every response, including error paths that never render the
 *      layout and therefore cannot rely on the `metadata` export.
 *
 * This is intentionally NOT the authorization check. The authoritative session
 * verification happens in `requireRfAdminSession` / `getRfAdminSession` on each
 * page and route handler — a proxy can be bypassed by internal subrequests, and
 * per Next's own guidance it is not a session-management mechanism. The
 * allowlist narrows who can reach the app at all; it does not decide who is
 * signed in.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");

  if (isIpAllowed(clientIpFromHeaders(request.headers), process.env.ADMIN_IP_ALLOWLIST)) {
    return response;
  }

  // Deliberately terse: do not confirm whether this host exists or why the
  // request was refused.
  return new NextResponse("Forbidden", {
    status: 403,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  // Everything except Next's own build internals and static files that are
  // safe to serve without a database check. Keeping the matcher broad is the
  // point: an allowlist that skips some paths is not an allowlist.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
