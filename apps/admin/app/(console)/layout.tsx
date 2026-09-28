/**
 * Protected layout for every RF Admin console screen.
 *
 * - Server component: session guard runs on the server before any child renders.
 * - Renders the sidebar navigation + main content area.
 * - Visual identity: uses --console-frame / --console-panel tokens so the chrome
 *   is perceptibly darker than the dashboard, signalling "internal tool".
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getRfAdminSession } from "@/lib/session";
import {
  Building2,
  BarChart3,
  ScrollText,
  ShieldCheck,
  Settings,
  LogOut,
  CreditCard,
} from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// ── Nav items ──────────────────────────────────────────────────────────────────

const NAV = [
  {
    href: "/console/organizations",
    label: "Organizations",
    icon: Building2,
  },
  {
    href: "/console/analytics",
    label: "System Analytics",
    icon: BarChart3,
  },
  {
    href: "/console/audit-log",
    label: "Audit Log",
    icon: ScrollText,
  },
] as const;

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getRfAdminSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen" style={{ background: "var(--console-frame)" }}>
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className="flex w-56 shrink-0 flex-col border-r"
        style={{
          background: "var(--console-panel)",
          borderColor: "var(--border)",
        }}
      >
        {/* Logo / wordmark */}
        <div
          className="flex h-14 items-center gap-2.5 border-b px-4"
          style={{ borderColor: "var(--border)" }}
        >
          <ShieldCheck
            className="size-4 shrink-0"
            style={{ color: "var(--accent)" }}
            aria-hidden="true"
          />
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            RF Admin
          </span>
          <span
            className="ml-auto rounded border px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              opacity: 0.7,
            }}
          >
            internal
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Console navigation">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              <Icon
                className="size-3.5 shrink-0 transition-colors group-hover:text-[var(--accent)]"
                aria-hidden="true"
              />
              <span className="group-hover:text-[var(--text-primary)]">{label}</span>
            </Link>
          ))}
        </nav>

        {/* Admin identity + sign-out */}
        <div
          className="flex flex-col gap-3 border-t p-3"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex flex-col gap-0.5 px-1">
            <span
              className="truncate text-xs font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {session.name}
            </span>
            <span
              className="truncate font-mono text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              {session.email}
            </span>
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-white/[0.05]"
              style={{ color: "var(--text-muted)" }}
            >
              <LogOut className="size-3" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
