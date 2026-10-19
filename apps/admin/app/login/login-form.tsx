"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowLeft, ShieldCheck } from "lucide-react";
import { SignIn6 } from "@/components/ui/sign-in-6";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Step = "credentials" | "mfa";

interface LoginFormProps {
  setupAvailable?: boolean;
}

export function LoginForm({ setupAvailable = false }: LoginFormProps) {
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
    <SignIn6
      brandName="RF Admin"
      tagline="Mission-critical operations and platform infrastructure control."
      proofCountText="Restricted to authorized RF staff"
      title={step === "credentials" ? "Admin Sign in" : "Two-Factor Authentication"}
      subtitle={
        step === "credentials"
          ? "Sign in with your RF operator credentials."
          : "Enter the 6-digit code from your authenticator app."
      }
      email={email}
      password={password}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={submitCredentials}
      loading={busy}
      error={error}
      submitButtonText="Continue"
      showGoogleAuth={false}
      badge={
        <span className="rounded border border-accent/40 bg-accent/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent font-semibold">
          Internal Console
        </span>
      }
      footerLink={
        <div className="flex flex-col items-center gap-3 mt-1">
          {setupAvailable && step === "credentials" ? (
            <Link
              href="/setup"
              className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20 transition-all"
            >
              <Sparkles className="size-3" />
              <span>Initial setup? Configure your account &rarr;</span>
            </Link>
          ) : null}
          <p className="text-center text-[11px] text-text-muted leading-relaxed max-w-xs">
            Access is restricted to authorized RF Intelligence staff. All sign-in attempts are logged in the audit trail.
          </p>
        </div>
      }
    >
      {step === "mfa" ? (
        <form onSubmit={submitMfa} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ss-code" className="text-xs text-text-secondary">
              Verification Code
            </Label>
            <Input
              id="ss-code"
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="border-white/10 bg-surface text-center font-mono text-xl tracking-[0.4em] text-white placeholder-text-muted focus:border-accent"
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStep("credentials");
                setCode("");
                setError(null);
              }}
              disabled={busy}
              className="w-1/3 border-white/10 bg-surface text-xs text-text-secondary hover:text-white"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
            <Button
              type="submit"
              disabled={busy || code.length !== 6}
              className="flex-1 bg-accent text-accent-fg hover:bg-accent-hover font-semibold text-xs py-2.5"
            >
              {busy ? "Verifying…" : "Verify & Sign in"}
            </Button>
          </div>
        </form>
      ) : null}
    </SignIn6>
  );
}

export default LoginForm;
