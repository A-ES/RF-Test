import type { NextConfig } from "next";

/**
 * RF Admin console.
 *
 * Deployed as its own Vercel project on its own subdomain
 * (admin.rfintelligence.<domain>). It shares only the Prisma schema and client
 * with the dashboard — never the database credential. See docs/ADMIN_APP.md.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@rf-intelligence/ui"],
  serverExternalPackages: ["@prisma/client", "@rf-intelligence/db"],
  /**
   * Identify this process as the console to `packages/db`, which selects
   * ADMIN_DATABASE_URL over DATABASE_URL.
   *
   * This MUST be set here rather than only in the Vercel environment. It is the
   * switch that stops the console from ever borrowing the dashboard's
   * tenant-scoped credential: without it, an unset RF_APP makes packages/db
   * resolve DATABASE_URL, and the dashboard connects as the table owner, which
   * bypasses RLS. That would quietly turn every cross-tenant query into a
   * same-tenant query and hand the console the wrong role's permissions.
   *
   * Hardcoded rather than read from process.env so it cannot be unset by a
   * missing or misspelled environment variable. It is not a secret.
   */
  env: { RF_APP: "admin" },
  async headers() {
    return [
      {
        // Applies to every route. This console must never be indexed, and must
        // never be cached by a shared proxy.
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Tailwind v4 injects styles at runtime; Next needs inline styles.
              "style-src 'self' 'unsafe-inline'",
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
