"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldCheck, ArrowRight, Loader2, Sparkles, Building2, Layers } from "lucide-react";

export default function LaunchPage() {
  const router = useRouter();
  const [stage, setStage] = useState(0);
  const [orgName, setOrgName] = useState("Your Workspace");

  const MILESTONES = [
    "Saving organization identity & business profile...",
    "Provisioning tenant data isolation boundaries...",
    "Configuring operational alert telemetry...",
    "Activating subscription entitlements...",
    "Finalizing executive overview dashboard...",
  ];

  useEffect(() => {
    async function completeFlow() {
      try {
        const res = await fetch("/api/onboarding/status");
        if (res.ok) {
          const data = await res.json();
          setOrgName(data.status?.companyName || "Your Workspace");
        }

        // Animate milestones
        for (let i = 0; i < MILESTONES.length; i++) {
          await new Promise((r) => setTimeout(r, 450));
          setStage(i + 1);
        }

        // Call completion API to persist completed=true
        await fetch("/api/onboarding/complete", { method: "POST" });

        // Short pause to show completed checkmark
        await new Promise((r) => setTimeout(r, 600));

        // Redirect to dashboard
        router.push("/dashboard");
        router.refresh();
      } catch (err) {
        console.error("Completion error:", err);
        router.push("/dashboard");
      }
    }

    completeFlow();
  }, []);

  return (
    <div className="py-12 flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Animated Glowing Ring */}
      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[#F24E4B]/20 blur-2xl rounded-full animate-pulse"
        />
        <div className="relative size-24 rounded-3xl bg-[#0D0E12] border border-white/10 flex items-center justify-center shadow-2xl">
          {stage >= MILESTONES.length ? (
            <CheckCircle2 className="size-12 text-[#F24E4B] animate-in zoom-in-75 duration-300" />
          ) : (
            <div className="size-10 rounded-full border-3 border-[#F24E4B] border-t-transparent animate-spin" />
          )}
        </div>
      </div>

      {/* Main Title Prompt Requirement */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-medium">
          <Sparkles className="size-3.5" />
          <span>INITIALIZATION COMPLETE</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
          Your RF Intelligence workspace is ready.
        </h1>

        <p className="text-sm text-white/60 max-w-md mx-auto">
          Welcome to <span className="text-white font-semibold">{orgName}</span>. Your workspace is configured with your operational preferences and telemetry.
        </p>
      </div>

      {/* Progress Checklist */}
      <div className="w-full rounded-2xl border border-white/10 bg-[#0D0E12] p-5 shadow-xl text-left space-y-2.5">
        {MILESTONES.map((milestone, idx) => {
          const isDone = stage > idx;
          const isCurrent = stage === idx;

          return (
            <div
              key={idx}
              className={`flex items-center gap-3 text-xs transition-opacity duration-300 ${
                isDone ? "text-white" : isCurrent ? "text-white/90" : "text-white/30"
              }`}
            >
              <div
                className={`size-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                  isDone
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : isCurrent
                    ? "border-2 border-[#F24E4B] border-t-transparent animate-spin"
                    : "border border-white/10"
                }`}
              >
                {isDone && <CheckCircle2 className="size-3" />}
              </div>
              <span className="font-mono text-[11px]">{milestone}</span>
            </div>
          );
        })}
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={() => {
            router.push("/dashboard");
            router.refresh();
          }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F24E4B] hover:bg-[#d63f3c] text-white py-3 px-8 text-sm font-semibold tracking-wide shadow-xl shadow-[#F24E4B]/25 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
        >
          <span>Open Dashboard Now</span>
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
