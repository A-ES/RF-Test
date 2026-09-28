import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDatabaseRoleInfo } from "@rf-intelligence/db";
import { getRfAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RF Admin",
  robots: { index: false, follow: false },
};

/**
 * Placeholder home for the RF Admin console.
 *
 * Per the foundation-only scope, this page establishes the authenticated shell
 * and nothing else — no feature screens are built here yet. The identity block
 * and the credential read-out are deliberate: they are the two things an
 * operator needs to confirm at a glance that the console is talking to the
 * right database as the right user.
 */
export default async function AdminHomePage() {
  const session = await getRfAdminSession();
  if (!session) redirect("/login");

  // Best-effort: a credential problem should not blank the console shell.
  const role = await getDatabaseRoleInfo().catch(() => null);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl text-text-primary">RF Admin</h1>
          <p className="text-sm text-text-muted">
            Foundation is in place. Feature screens arrive in the next phase.
          </p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-widest text-text-muted">Signed in</h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border text-sm">
          <Row label="Name" value={session.name} />
          <Row label="Email" value={session.email} />
          <Row label="Admin ID" value={session.adminId} mono />
          <Row label="Mode" value={session.mode} mono />
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-widest text-text-muted">
          Database credential
        </h2>
        {role ? (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border text-sm">
            <Row label="Role" value={role.currentUser} mono />
            <Row
              label="BYPASSRLS"
              value={role.bypassRls ? "yes (expected)" : "NO — misconfigured"}
              mono
              tone={role.bypassRls ? "default" : "danger"}
            />
          </dl>
        ) : (
          <p className="rounded border border-border bg-console-panel p-4 text-sm text-text-muted">
            Database role could not be read. Check{" "}
            <code className="font-mono text-xs">ADMIN_DATABASE_URL</code> and{" "}
            <code className="font-mono text-xs">/api/health</code>.
          </p>
        )}
        <p className="text-xs leading-relaxed text-text-muted">
          This app is scoped to the dedicated <code className="font-mono">rf_admin_app</code>{" "}
          role and must never be configured with the dashboard&apos;s{" "}
          <code className="font-mono">DATABASE_URL</code>.
        </p>
      </section>

      <footer className="border-t border-border pt-6 text-xs text-text-muted">
        See <code className="font-mono">docs/ADMIN_APP.md</code> in the repository
        for the credential matrix, deployment steps and Vercel protection setup.
      </footer>
    </main>
  );
}

function Row({
  label,
  value,
  mono,
  tone = "default",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <>
      <dt className="bg-console-panel px-4 py-2 text-xs text-text-muted">{label}</dt>
      <dd
        className={`bg-console-panel px-4 py-2 ${mono ? "font-mono text-xs" : ""} ${
          tone === "danger" ? "text-red-400" : "text-text-primary"
        }`}
      >
        {value}
      </dd>
    </>
  );
}
