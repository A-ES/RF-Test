"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  QrCode,
  Copy,
  Check,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  Sparkles,
} from "lucide-react";
import { SignIn6 } from "@/components/ui/sign-in-6";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  const getTitle = () => {
    if (step === "account") return "Initial Admin Setup";
    if (step === "mfa") return "Two-Factor Authentication";
    return "Setup Complete!";
  };

  const getSubtitle = () => {
    if (step === "account") return "Create your primary operator account to secure the console.";
    if (step === "mfa") return "Scan the QR code with your authenticator app to enable 2FA.";
    return "Your administrator account has been secured with 2FA.";
  };

  return (
    <SignIn6
      brandName="RF Admin"
      tagline="Mission-critical operations and platform infrastructure control."
      proofCountText="Platform security initialization"
      title={getTitle()}
      subtitle={getSubtitle()}
      loading={loading}
      error={error}
      className="max-w-4xl"
      badge={
        <div className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent">
          <Sparkles className="h-3 w-3" />
          <span>Guided Setup</span>
        </div>
      }
    >
      {/* 2-Step Progress Indicator */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-all ${
            step === "account"
              ? "border-accent bg-accent/10 text-white font-medium"
              : "border-white/5 bg-white/[0.02] text-text-muted"
          }`}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              step !== "account" ? "bg-accent/20 text-accent" : "bg-accent text-accent-fg"
            }`}
          >
            1
          </span>
          <span className="truncate">Admin Account</span>
        </div>
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-all ${
            step === "mfa" || step === "success"
              ? "border-accent bg-accent/10 text-white font-medium"
              : "border-white/5 bg-white/[0.02] text-text-muted"
          }`}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              step === "success" ? "bg-accent text-accent-fg" : "bg-white/10 text-white"
            }`}
          >
            2
          </span>
          <span className="truncate">2FA Pairing</span>
        </div>
      </div>

      {/* Step 1: Account Credentials */}
      {step === "account" ? (
        <form onSubmit={handleInitiateSetup} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-name" className="text-xs text-text-secondary">
              Your Display Name
            </Label>
            <Input
              id="setup-name"
              type="text"
              required
              placeholder="e.g. Alex Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-white/10 bg-surface text-white placeholder-text-muted focus:border-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-email" className="text-xs text-text-secondary">
              Admin Email Address
            </Label>
            <Input
              id="setup-email"
              type="email"
              required
              placeholder="e.g. admin@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-white/10 bg-surface text-white placeholder-text-muted focus:border-accent"
            />
            <p className="text-[11px] text-text-muted">
              This replaces the placeholder email and will be your permanent login address.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-password" className="text-xs text-text-secondary">
              Admin Password
            </Label>
            <div className="relative">
              <Input
                id="setup-password"
                type={showPassword ? "text" : "password"}
                required
                placeholder="Choose a strong password (min 12 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-white/10 bg-surface pr-10 text-white placeholder-text-muted focus:border-accent"
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

            {/* Checklist */}
            <div className="mt-1 flex flex-col gap-1 text-[11px]">
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-confirm-password" className="text-xs text-text-secondary">
              Confirm Password
            </Label>
            <Input
              id="setup-confirm-password"
              type="password"
              required
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="border-white/10 bg-surface text-white placeholder-text-muted focus:border-accent"
            />
            {confirmPassword && !passwordsMatch ? (
              <p className="text-[11px] text-red-400">Passwords do not match.</p>
            ) : null}
          </div>

          <Button
            type="submit"
            disabled={loading || !hasMinLength || !passwordsMatch || !email}
            className="mt-2 w-full bg-accent text-accent-fg hover:bg-accent-hover font-semibold text-xs py-2.5 shadow-lg shadow-accent/20"
          >
            {loading ? "Generating Security Keys…" : "Continue to 2FA Setup"}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </form>
      ) : null}

      {/* Step 2: MFA Pairing */}
      {step === "mfa" ? (
        <form onSubmit={handleVerifyMfa} className="flex flex-col gap-4">
          <div className="rounded-xl border border-white/10 bg-surface/50 p-3.5">
            <div className="flex items-center gap-2 mb-1">
              <QrCode className="h-4 w-4 text-accent" />
              <span className="text-xs font-semibold text-white">Scan with Authenticator App</span>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Scan with Google Authenticator, Microsoft Authenticator, 1Password, or Apple Passwords:
            </p>

            <div className="my-3 flex items-center justify-center">
              {qrCodeUrl ? (
                <div className="rounded-xl bg-white p-2.5 shadow-md border-2 border-accent/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrCodeUrl} alt="2FA QR Code" className="h-40 w-40 rounded" />
                </div>
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded-xl bg-black/40 text-xs text-text-muted">
                  Loading QR Code…
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/5 bg-black/40 p-2 text-[11px]">
              <div className="mb-1 flex items-center justify-between text-text-muted">
                <span>Manual key:</span>
                <button
                  type="button"
                  onClick={copySecretKey}
                  className="flex items-center gap-1 text-accent hover:underline"
                >
                  {copiedKey ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedKey ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="font-mono text-[11px] font-semibold text-white break-all select-all">
                {totpSecret}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mfa-verify-code" className="text-xs text-text-secondary">
              Enter 6-digit Code from Authenticator
            </Label>
            <Input
              id="mfa-verify-code"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              required
              placeholder="000000"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
              className="border-white/10 bg-surface text-center font-mono text-xl tracking-[0.4em] text-white placeholder-text-muted focus:border-accent"
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("account")}
              disabled={loading}
              className="w-1/3 border-white/10 bg-surface text-xs text-text-secondary hover:text-white"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
            <Button
              type="submit"
              disabled={loading || mfaCode.length !== 6}
              className="flex-1 bg-accent text-accent-fg hover:bg-accent-hover font-semibold text-xs py-2.5 shadow-lg shadow-accent/20"
            >
              {loading ? "Verifying…" : "Complete Setup & Sign In"}
              <Check className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </form>
      ) : null}

      {/* Step 3: Success state */}
      {step === "success" ? (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Check className="h-7 w-7 animate-bounce" />
          </div>
          <h2 className="text-lg font-bold text-white mb-1">Setup Complete!</h2>
          <p className="text-xs text-text-muted max-w-xs mb-5">
            Your administrator account has been secured with 2FA. Redirecting you to the console…
          </p>
          <div className="flex items-center gap-2 text-xs text-accent">
            <div className="h-2 w-2 animate-ping rounded-full bg-accent" />
            Launching dashboard…
          </div>
        </div>
      ) : null}
    </SignIn6>
  );
}

export default SetupWizard;
