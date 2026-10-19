"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home, ShieldAlert } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin console error:", error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center p-6 text-center"
      style={{ background: "var(--console-frame, #05060a)" }}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-white/10 bg-[#12151d] p-8 shadow-2xl backdrop-blur-xl">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <ShieldAlert className="h-7 w-7" />
        </div>

        <h1 className="text-lg font-bold text-white tracking-tight">Admin Console</h1>
        <p className="text-xs text-text-muted leading-relaxed">
          {error.message && !error.message.includes("Minified")
            ? error.message
            : "An unexpected error occurred while loading this page. Please try reloading or check your database connection."}
        </p>

        {error.digest ? (
          <div className="rounded border border-white/5 bg-black/40 px-2 py-1 font-mono text-[10px] text-text-muted">
            Digest: {error.digest}
          </div>
        ) : null}

        <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition-all hover:bg-accent-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload Page
          </button>
          <Link
            href="/setup"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-white/10"
          >
            <Home className="h-3.5 w-3.5" />
            Go to Setup
          </Link>
        </div>
      </div>
    </div>
  );
}
