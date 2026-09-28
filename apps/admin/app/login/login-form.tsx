"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type Step = "credentials" | "mfa";

/**
 * Two-step sign-in form: password, then TOTP.
 *
 * The password step never yields a session on its own — the server only issues
 * a pending MFA challenge — so this component cannot skip straight to the
 * console by manipulating client state.
 */
export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitCredentials = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error ?? "Sign-in failed");
          return;
        }
        setStep("mfa");
        setPassword("");
      } finally {
        setBusy(false);
      }
    },
    [email, password],
  );

  const submitMfa = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/auth/login/mfa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error ?? "Verification failed");
          return;
        }
        // Full reload so the server re-renders with the new cookie.
        router.replace("/");
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [code, router],
  );

  return (
    <form
      onSubmit={step === "credentials" ? submitCredentials : submitMfa}
      className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-console-panel p-6"
    >
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-lg text-text-primary">RF Admin</h1>
        <p className="text-xs text-text-muted">
          {step === "credentials"
            ? "Internal operations console. Sign in with your RF admin account."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
      </div>

      {step === "credentials" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Email
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Verification code
          <input
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="rounded border border-border bg-surface px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-text-primary outline-none focus:border-accent"
          />
        </label>
      )}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? "Checking…" : step === "credentials" ? "Continue" : "Verify"}
      </button>
    </form>
  );
}
