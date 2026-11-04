"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ArrowRight, Loader2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, organizationName, email, password }),
      });

      const data = (await res.json().catch(() => null)) as { error?: string; redirectTo?: string } | null;

      if (!res.ok) {
        setError(data?.error || "Registration failed. Please verify your details.");
        return;
      }

      router.push(data?.redirectTo || "/onboarding/plan");
      router.refresh();
    } catch {
      setError("Unable to connect to the server. Please check your network.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4 sm:p-6 bg-[#05060A] text-[#F5F5F0]">
      <div className="w-full max-w-[460px] rounded-2xl border border-white/10 bg-[#0D0E12] p-8 shadow-2xl relative overflow-hidden">
        {/* Subtle red glow accent at top */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#F24E4B]/15 blur-3xl rounded-full"
        />

        {/* Brand header */}
        <div className="flex items-center gap-2 mb-6">
          <div className="size-8 rounded-lg bg-[#F24E4B] flex items-center justify-center font-bold text-black text-sm tracking-wider">
            RF
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white leading-none">
              RF Intelligence
            </h1>
            <p className="text-[11px] text-white/50 tracking-wide font-mono mt-0.5">
              ENTERPRISE WHOLESALE PLATFORM
            </p>
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-xl font-bold tracking-tight text-white">Create your workspace</h2>
          <p className="text-xs text-white/60 mt-1">
            Start your onboarding to configure tailored wholesale intelligence and connect your team.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-[#F24E4B]/30 bg-[#F24E4B]/10 px-3.5 py-2.5 text-xs text-[#F24E4B]">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/80 mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Morgan"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/80 mb-1.5">
              Company / Workspace Name
            </label>
            <input
              type="text"
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="e.g. Pacific Coast Distribution"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/80 mb-1.5">
              Work Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@pacificdist.com"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/80 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 rounded-lg bg-[#F24E4B] hover:bg-[#d63f3c] text-white py-2.5 px-4 text-sm font-semibold tracking-wide transition-all shadow-lg shadow-[#F24E4B]/20 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Creating workspace...</span>
              </>
            ) : (
              <>
                <span>Get Started & Choose Plan</span>
                <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-white/10 flex items-center justify-between text-xs text-white/60">
          <span>Already have an account?</span>
          <a href="/login" className="text-[#F24E4B] font-medium hover:underline">
            Sign in here
          </a>
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/40">
          <ShieldCheck className="size-3.5 text-emerald-400" />
          <span>Tenant isolated & securely encrypted</span>
        </div>
      </div>
    </div>
  );
}
