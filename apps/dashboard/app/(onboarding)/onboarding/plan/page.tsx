"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Users, ArrowRight, Shield, Zap, Sparkles, AlertCircle } from "lucide-react";

interface PlanItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: string;
  seatLimit: number;
  features: string[];
}

export default function PlanSelectionPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStatus() {
      try {
        const res = await fetch("/api/onboarding/status");
        if (!res.ok) {
          setError("Failed to load available plans. Please refresh.");
          return;
        }
        const data = await res.json();
        setPlans(data.plans || []);
        // Default select RF Pro or active subscription plan if present
        if (data.plans?.length > 0) {
          const proPlan = data.plans.find((p: PlanItem) => p.slug === "rf-pro") || data.plans[0];
          setSelectedPlanId(proPlan.id);
        }
      } catch {
        setError("Network error while connecting to plan catalog.");
      } finally {
        setLoading(false);
      }
    }
    loadStatus();
  }, []);

  function handleContinue() {
    if (!selectedPlanId) return;
    // Pass selected plan to checkout
    router.push(`/onboarding/checkout?planId=${selectedPlanId}`);
  }

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="size-8 rounded-full border-2 border-[#F24E4B] border-t-transparent animate-spin mb-4" />
        <p className="text-sm text-white/60 font-mono">Loading plan catalog...</p>
      </div>
    );
  }

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-2.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F24E4B]/10 border border-[#F24E4B]/30 text-[#F24E4B] text-xs font-mono font-medium">
          <Sparkles className="size-3.5" />
          <span>STEP 1 OF 6 &bull; SUBSCRIPTION PLAN</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Choose your RF Intelligence plan
        </h1>
        <p className="text-sm text-white/60 max-w-lg mx-auto">
          Select the capacity tailored to your wholesale team. Plan limits and team access can be scaled as your operations expand.
        </p>
      </div>

      {/* Pricing Notice Badge */}
      <div className="max-w-xl mx-auto rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-start gap-3 text-xs text-amber-200/90">
        <AlertCircle className="size-4 shrink-0 text-amber-400 mt-0.5" />
        <div>
          <span className="font-semibold text-amber-300">Configurable Placeholder Pricing:</span>{" "}
          Display rates are placeholder indicators for the simulation environment. Commercial billing and tiered agreements will be finalized upon enterprise rollout.
        </div>
      </div>

      {error && (
        <div className="max-w-xl mx-auto rounded-lg border border-[#F24E4B]/40 bg-[#F24E4B]/10 p-3 text-xs text-[#F24E4B] text-center">
          {error}
        </div>
      )}

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {plans.map((plan) => {
          const isSelected = plan.id === selectedPlanId;
          const isUltra = plan.slug === "rf-ultra";
          const additionalMembers = plan.slug === "rf-ultra" ? 10 : 4;
          const priceDisplay = (plan.priceCents / 100).toFixed(0);

          return (
            <div
              key={plan.id}
              onClick={() => setSelectedPlanId(plan.id)}
              className={`relative cursor-pointer rounded-2xl border p-6 sm:p-8 transition-all flex flex-col justify-between ${
                isSelected
                  ? "border-[#F24E4B] bg-[#0E0F14] shadow-xl shadow-[#F24E4B]/15 ring-1 ring-[#F24E4B]"
                  : "border-white/10 bg-[#0B0C10] hover:border-white/20 hover:bg-[#0E0F14]"
              }`}
            >
              {isUltra && (
                <div className="absolute -top-3 right-6 px-3 py-0.5 rounded-full bg-[#F24E4B] text-black text-[10px] font-bold tracking-wider uppercase font-mono shadow-md">
                  RECOMMENDED FOR GROWING TEAMS
                </div>
              )}

              <div>
                {/* Plan Header */}
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`size-10 rounded-xl flex items-center justify-center ${
                        isSelected
                          ? "bg-[#F24E4B] text-black"
                          : "bg-white/10 text-white/80"
                      }`}
                    >
                      {isUltra ? <Zap className="size-5" /> : <Shield className="size-5" />}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-tight">
                        {plan.name}
                      </h2>
                      <span className="text-xs text-white/50 font-mono">
                        {isUltra ? "Large teams & multi-depot" : "Smaller teams & agile wholesale"}
                      </span>
                    </div>
                  </div>

                  {/* Radio indicator */}
                  <div
                    className={`size-5 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected
                        ? "border-[#F24E4B] bg-[#F24E4B]"
                        : "border-white/30 bg-transparent"
                    }`}
                  >
                    {isSelected && <Check className="size-3 text-black stroke-[3]" />}
                  </div>
                </div>

                <p className="text-xs text-white/70 leading-relaxed mb-6">
                  {plan.description}
                </p>

                {/* Pricing Block */}
                <div className="mb-6 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-extrabold text-white tracking-tight">
                      ${priceDisplay}
                    </span>
                    <span className="text-xs text-white/50 font-mono">/ month</span>
                    <span className="ml-auto text-[10px] text-amber-400 font-mono bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                      Placeholder
                    </span>
                  </div>

                  {/* Seat Limit Highlight */}
                  <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2 text-xs font-medium text-[#F24E4B]">
                    <Users className="size-4" />
                    <span>Up to {additionalMembers} additional team members</span>
                  </div>
                </div>

                {/* Features List */}
                <div className="space-y-2.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-white/40 block">
                    What&apos;s Included:
                  </span>
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-xs text-white/85">
                      <div className="size-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="size-2.5 stroke-[3]" />
                      </div>
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom selection indicator */}
              <div className="mt-8 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                    isSelected
                      ? "bg-[#F24E4B] text-white shadow-lg shadow-[#F24E4B]/20"
                      : "bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
                  }`}
                >
                  {isSelected ? "Selected" : "Select " + plan.name}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Bar */}
      <div className="max-w-4xl mx-auto pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl border border-white/10 bg-[#0B0C10]">
        <div>
          <div className="text-xs font-medium text-white">
            Selected: <span className="text-[#F24E4B] font-semibold">{selectedPlan?.name}</span>
          </div>
          <div className="text-[11px] text-white/50">
            Next: Simulated Payment with Card or UPI (No real charges)
          </div>
        </div>

        <button
          type="button"
          onClick={handleContinue}
          disabled={!selectedPlanId}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#F24E4B] hover:bg-[#d63f3c] text-white py-2.5 px-6 text-sm font-semibold tracking-wide shadow-lg shadow-[#F24E4B]/20 disabled:opacity-50 transition-all"
        >
          <span>Continue to Payment</span>
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
