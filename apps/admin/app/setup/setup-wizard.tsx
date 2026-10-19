"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  KeyRound,
  QrCode,
  Copy,
  Check,
  ArrowRight,
  Eye,
  EyeOff,
  Sparkles,
  Lock,
} from "lucide-react";

type SetupStep = "account" | "mfa" | "success";

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>("account");

  // Step 1: Account credentials
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Step 2: MFA data
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);

  // Status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password requirements
  const hasMinLength = password.length >= 12;
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasNumberOrSymbol = /[\d\W]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const handleInitiateSetup = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!hasMinLength) {
        setError("Password must be at least 12 characters long.");
        return;
      }
      if (!passwordsMatch) {
        setError("Passwords do not match.");
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/setup/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to initiate setup.");
          return;
        }

        setQrCodeUrl(data.qrCode);
        setTotpSecret(data.secret);
        setStep("mfa");
      } catch {
        setError("A network error occurred. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [name, email, password, hasMinLength, passwordsMatch],
  );

  const handleVerifyMfa = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (mfaCode.length !== 6) {
        setError("Please enter the complete 6-digit verification code.");
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/setup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: mfaCode }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Verification failed. Check code and try again.");
          return;
        }

        setStep("success");
        setTimeout(() => {
          router.replace("/console/organizations");
          router.refresh();
        }, 1600);
      } catch {
        setError("Failed to verify code. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [mfaCode, router],
  );

  const copySecretKey = () => {
    if (!totpSecret) return;
    navigator.clipboard.writeText(totpSecret);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#12151d] p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-white/10 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">RF Admin Console</h1>
            <p className="text-xs text-text-muted">Initial Setup & Security Wizard</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent border border-accent/25">
          <Sparkles className="h-3 w-3" />
          Guided Setup
        </div>
      </div>

      {/* Progress Steps */}
      <div className="mb-8 grid grid-cols-2 gap-2 text-xs">
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-all ${
            step === "account"
              ? "border-accent bg-accent/10 text-white font-medium"
              : "border-white/5 bg-white/[0.02] text-text-muted"
          }`}
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            step !== "account" ? "bg-accent/20 text-accent" : "bg-accent text-accent-fg"
          }`}>
            1
          </span>
          <span>Admin Account</span>
        </div>
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-all ${
            step === "mfa" || step === "success"
              ? "border-accent bg-accent/10 text-white font-medium"
              : "border-white/5 bg-white/[0.02] text-text-muted"
          }`}
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            step === "success" ? "bg-accent text-accent-fg" : "bg-white/10 text-white"
          }`}>
            2
          </span>
          <span>2FA Authenticator</span>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      ) : null}

      {/* Step 1: Account Credentials */}
      {step === "account" ? (
        <form onSubmit={handleInitiateSetup} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Your Display Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Alex Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm text-white placeholder-text-muted outline-none transition-colors focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Admin Email Address
            </label>
            <input
              type="email"
              required
              placeholder="e.g. admin@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm text-white placeholder-text-muted outline-none transition-colors focus:border-accent"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              This replaces the default placeholder email and will be your login address.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Admin Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                placeholder="Choose a strong password (min 12 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 pr-10 text-sm text-white placeholder-text-muted outline-none transition-colors focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-white"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Password checklist */}
            <div className="mt-2 flex flex-col gap-1 text-[11px]">
              <span className={`flex items-center gap-1.5 ${hasMinLength ? "text-emerald-400" : "text-text-muted"}`}>
                <Check className="h-3 w-3" /> At least 12 characters
              </span>
              <span className={`flex items-center gap-1.5 ${hasMixedCase ? "text-emerald-400" : "text-text-muted"}`}>
                <Check className="h-3 w-3" /> Uppercase and lowercase letters
              </span>
              <span className={`flex items-center gap-1.5 ${hasNumberOrSymbol ? "text-emerald-400" : "text-text-muted"}`}>
                <Check className="h-3 w-3" /> Numbers or symbols
              </span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Confirm Password
            </label>
            <input
              type="password"
              required
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm text-white placeholder-text-muted outline-none transition-colors focus:border-accent"
            />
            {confirmPassword && !passwordsMatch ? (
              <p className="mt-1 text-[11px] text-red-400">Passwords do not match.</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={loading || !hasMinLength || !passwordsMatch || !email}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Generating Security Keys…" : "Continue to 2FA Setup"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      ) : null}

      {/* Step 2: MFA Pairing */}
      {step === "mfa" ? (
        <form onSubmit={handleVerifyMfa} className="flex flex-col gap-5">
          <div className="rounded-xl border border-white/10 bg-surface/50 p-4">
            <h2 className="mb-1 text-sm font-semibold text-white flex items-center gap-2">
              <QrCode className="h-4 w-4 text-accent" />
              Scan with your Authenticator App
            </h2>
            <p className="text-xs text-text-muted leading-relaxed">
              Open Google Authenticator, Microsoft Authenticator, 1Password, or Apple Passwords on your phone and scan the QR code below:
            </p>

            {/* QR Code Container */}
            <div className="my-4 flex flex-col items-center justify-center">
              {qrCodeUrl ? (
                <div className="rounded-xl bg-white p-3 shadow-md border-2 border-accent/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrCodeUrl} alt="2FA QR Code" className="h-48 w-48 rounded" />
                </div>
              ) : (
                <div className="flex h-48 w-48 items-center justify-center rounded-xl bg-black/40 text-xs text-text-muted">
                  Loading QR Code…
                </div>
              )}
            </div>

            {/* Manual Secret Key option */}
            <div className="rounded-lg border border-white/5 bg-black/40 p-2.5">
              <div className="mb-1 flex items-center justify-between text-[11px] text-text-muted">
                <span>Can't scan? Enter key manually:</span>
                <button
                  type="button"
                  onClick={copySecretKey}
                  className="flex items-center gap-1 text-accent hover:underline"
                >
                  {copiedKey ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedKey ? "Copied!" : "Copy Key"}
                </button>
              </div>
              <p className="font-mono text-xs font-semibold tracking-wider text-white break-all select-all">
                {totpSecret}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Enter 6-digit Code from Authenticator
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              required
              placeholder="000000"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2.5 text-center font-mono text-xl tracking-[0.4em] text-white placeholder-text-muted outline-none transition-colors focus:border-accent"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("account")}
              disabled={loading}
              className="w-1/3 rounded-lg border border-white/10 bg-transparent py-2.5 text-sm font-medium text-text-secondary hover:bg-white/5 hover:text-white"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading || mfaCode.length !== 6}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Complete Setup & Sign In"}
              <Check className="h-4 w-4" />
            </button>
          </div>
        </form>
      ) : null}

      {/* Step 3: Success state */}
      {step === "success" ? (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Check className="h-8 w-8 animate-bounce" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">Setup Complete!</h2>
          <p className="text-xs text-text-muted max-w-xs mb-6">
            Your administrator account has been secured with 2FA. Redirecting you to the console…
          </p>
          <div className="flex items-center gap-2 text-xs text-accent">
            <div className="h-2 w-2 animate-ping rounded-full bg-accent" />
            Launching dashboard…
          </div>
        </div>
      ) : null}
    </div>
  );
}
