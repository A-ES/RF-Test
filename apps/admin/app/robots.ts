import type { MetadataRoute } from "next";

/**
 * Belt-and-braces with the `X-Robots-Tag` header and the layout metadata: this
 * makes /robots.txt itself refuse to list anything, and disallows the whole
 * site for crawvers that read robots.txt rather than headers.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
