"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignIn6 } from "@/components/ui/sign-in-6";

const DEMO_EMAIL = "jordan.ellis@acmecorp.com";
const DEMO_PASSWORD = "password";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Sign in failed. Please try again.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const handleGoogleSignIn = () => {
    // Fill demo credentials and sign in
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    void handleSignIn({ preventDefault: () => {} } as React.FormEvent);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4 sm:p-6 bg-[var(--background,#05060A)]">
      <SignIn6
        brandName="RF Intelligence"
        tagline="Where distribution moves at conversation speed."
        proofCountText="Join 40,000+ teams on RF Intelligence"
        title="Welcome back"
        subtitle="Sign in to your wholesale workspace."
        email={email}
        password={password}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={handleSignIn}
        loading={loading}
        error={error}
        submitButtonText="Sign in"
        showGoogleAuth={true}
        onGoogleClick={handleGoogleSignIn}
        footerLink={
          <p className="text-center text-xs text-[var(--text-muted,rgba(245,245,240,0.6))] mt-2">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => setError("Account access requests are managed by your workspace administrator.")}
              className="text-[var(--accent,#F24E4B)] font-medium hover:underline"
            >
              Request access
            </button>
          </p>
        }
      />
    </div>
  );
}
