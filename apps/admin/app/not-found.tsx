import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-text-muted">404</p>
      <p className="text-sm text-text-secondary">This page does not exist.</p>
      <Link href="/" className="text-xs text-text-muted underline">
        Return to RF Admin
      </Link>
    </main>
  );
}
