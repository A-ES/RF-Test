import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Root layout for the RF Admin console.
 *
 * `robots: { index: false, follow: false }` emits the page-level noindex; the
 * `X-Robots-Tag` header in next.config.ts covers every response including
 * redirects and 404s, which metadata cannot.
 */
export const metadata: Metadata = {
  title: {
    default: "RF Admin",
    template: "%s — RF Admin",
  },
  description: "RF Intelligence internal operations console.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = {
  themeColor: "#05060A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
