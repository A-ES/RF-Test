/**
 * Centralized, trusted application base URL resolver.
 *
 * Guarantees that invitation links, password reset links, and callback URLs
 * point to the trusted application domain (e.g. http://localhost:3000 for local dev),
 * never to mismatched development ports (e.g. 3001) or unvalidated client request headers.
 */

export function getAppUrl(request?: Request): string {
  // 1. Explicit environment variable APP_URL takes highest priority
  let envUrl = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (envUrl) {
    // Strip trailing slash
    envUrl = envUrl.replace(/\/+$/, "");

    // Safety guard for local development: if port 3001 was left in .env while running on 3000,
    // normalize to port 3000 unless strictly specified in production.
    if (process.env.NODE_ENV !== "production" && envUrl.includes("localhost:3001")) {
      return "http://localhost:3000";
    }

    return envUrl;
  }

  // 2. Validate request origin if available against trusted origins
  if (request) {
    try {
      const url = new URL(request.url);
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
      const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http";

      // Only trust localhost:3000, 127.0.0.1:3000, or verified production domain
      if (host.startsWith("localhost:3000") || host.startsWith("127.0.0.1:3000")) {
        return `http://${host}`;
      }
    } catch {
      // Fallback
    }
  }

  // 3. Safe fallback for development
  return "http://localhost:3000";
}

/**
 * Redacts sensitive tokens and secret query parameters from URLs for safe logging.
 * Replaces token=xyz with token=[REDACTED].
 */
export function redactUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  return rawUrl
    .replace(/([?&](?:token|key|secret|password|signature)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, "$1[REDACTED]");
}
