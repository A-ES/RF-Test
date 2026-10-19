"use client";

import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

const defaultProof = [
  {
    initials: "JD",
    src: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face",
  },
  {
    initials: "MK",
    src: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face",
  },
  {
    initials: "AR",
    src: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face",
  },
];

export interface SignIn6Props {
  brandName?: string;
  tagline?: string;
  proofCountText?: string;
  title?: string;
  subtitle?: string;
  email?: string;
  password?: string;
  onEmailChange?: (email: string) => void;
  onPasswordChange?: (password: string) => void;
  onSubmit?: (e: React.FormEvent) => void;
  loading?: boolean;
  error?: string | null;
  submitButtonText?: string;
  showGoogleAuth?: boolean;
  onGoogleClick?: () => void;
  footerLink?: React.ReactNode;
  children?: React.ReactNode;
  badge?: React.ReactNode;
}

export function SignIn6({
  brandName = "RF Admin",
  tagline = "Internal infrastructure & mission-critical operations control.",
  proofCountText = "Restricted to verified RF staff",
  title = "Welcome back",
  subtitle = "Sign in to access the RF Admin Console.",
  email = "",
  password = "",
  onEmailChange,
  onPasswordChange,
  onSubmit,
  loading = false,
  error = null,
  submitButtonText = "Sign in",
  showGoogleAuth = false,
  onGoogleClick,
  footerLink,
  children,
  badge,
}: SignIn6Props) {
  return (
    <Card className="grid w-full max-w-3xl gap-0 overflow-hidden border border-white/10 bg-[#12151d] p-0 shadow-2xl backdrop-blur-xl md:grid-cols-2">
      {/* Left hero banner */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-b from-accent-deep/40 via-surface to-[#0d0e12] p-8 text-white md:flex border-r border-white/5">
        <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-accent/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 size-64 rounded-full bg-accent-deep/20 blur-3xl" />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-accent/20 ring-1 ring-accent/30">
              <div className="size-3 rotate-45 rounded-[3px] bg-accent" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-white">{brandName}</span>
          </div>
          {badge}
        </div>

        <h2 className="relative mt-auto max-w-[15ch] text-[24px] font-semibold leading-[1.2] tracking-tight text-balance text-white">
          {tagline}
        </h2>

        <div className="relative mt-8 flex items-center gap-3">
          <div className="flex -space-x-2.5">
            {defaultProof.map((p) => (
              <Avatar key={p.initials} className="size-7 ring-2 ring-white/10">
                <AvatarImage src={p.src} alt="" className="object-cover" />
                <AvatarFallback className="bg-surface-elevated text-[10px] font-medium text-white">
                  {p.initials}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
          <span className="text-xs text-text-muted">{proofCountText}</span>
        </div>
      </div>

      {/* Right form section */}
      <div className="flex flex-col justify-center gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <span className="text-lg font-semibold tracking-tight text-white">{title}</span>
          <span className="text-xs text-text-muted">{subtitle}</span>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
            {error}
          </div>
        ) : null}

        {children ? (
          children
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {showGoogleAuth ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onGoogleClick}
                  className="w-full justify-center gap-2 border-white/10 bg-surface hover:bg-white/5 text-xs text-white"
                >
                  <GoogleIcon />
                  Continue with Google
                </Button>

                <div className="flex items-center gap-3 my-1">
                  <span className="h-px flex-1 bg-white/10" />
                  <span className="text-[10px] uppercase tracking-wider text-text-muted">or</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
              </>
            ) : null}

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ss-email" className="text-xs text-text-secondary">
                  Email
                </Label>
                <Input
                  id="ss-email"
                  type="email"
                  required
                  placeholder="you@rf-intelligence.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => onEmailChange?.(e.target.value)}
                  className="border-white/10 bg-surface text-white placeholder-text-muted focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ss-password" className="text-xs text-text-secondary">
                    Password
                  </Label>
                </div>
                <Input
                  id="ss-password"
                  type="password"
                  required
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => onPasswordChange?.(e.target.value)}
                  className="border-white/10 bg-surface text-white placeholder-text-muted focus:border-accent"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 w-full bg-accent text-accent-fg hover:bg-accent-hover font-semibold text-xs py-2.5"
            >
              {loading ? "Verifying…" : submitButtonText}
            </Button>
          </form>
        )}

        {footerLink}
      </div>
    </Card>
  );
}

export default SignIn6;
