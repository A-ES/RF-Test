"use client";

import { usePathname } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";

interface OnboardingNavProps {
  userName: string;
  userEmail: string;
  avatarInitials?: string;
  orgName: string;
  currentStep: number;
  hasActiveSubscription: boolean;
}

const STEPS = [
  { id: 1, path: "/onboarding/plan", label: "Plan" },
  { id: 2, path: "/onboarding/checkout", label: "Payment" },
  { id: 3, path: "/onboarding/identity", label: "Identity" },
  { id: 4, path: "/onboarding/business", label: "Operations" },
  { id: 5, path: "/onboarding/team", label: "Team" },
  { id: 6, path: "/onboarding/presentation", label: "Showcase" },
];

export function OnboardingNav({
  userName,
  avatarInitials,
  orgName,
}: OnboardingNavProps) {
  const pathname = usePathname();

  const activeIndex = STEPS.findIndex((s) => pathname.startsWith(s.path));
  const activeStep = activeIndex >= 0 ? activeIndex + 1 : 1;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-[#05060A]/90 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-[#F24E4B] flex items-center justify-center font-bold text-black text-sm tracking-wider shadow-md shadow-[#F24E4B]/20">
            RF
          </div>
          <div className="hidden sm:block">
            <span className="text-sm font-semibold tracking-tight text-white block leading-tight">
              RF Intelligence
            </span>
            <span className="text-[10px] text-white/50 tracking-wider font-mono uppercase block">
              {orgName}
            </span>
          </div>
        </div>

        {/* Step Progress Indicator */}
        <nav aria-label="Onboarding Progress" className="flex items-center gap-1 sm:gap-2">
          {STEPS.map((step, idx) => {
            const isCompleted = step.id < activeStep;
            const isCurrent = step.id === activeStep;

            return (
              <div key={step.id} className="flex items-center">
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                    isCurrent
                      ? "bg-[#F24E4B]/15 text-[#F24E4B] border border-[#F24E4B]/40"
                      : isCompleted
                      ? "text-white/80 hover:text-white"
                      : "text-white/30"
                  }`}
                >
                  <span
                    className={`size-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                      isCompleted
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : isCurrent
                        ? "bg-[#F24E4B] text-black font-bold"
                        : "bg-white/10 text-white/40"
                    }`}
                  >
                    {isCompleted ? <Check className="size-2.5 stroke-[3]" /> : step.id}
                  </span>
                  <span className="hidden md:inline">{step.label}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <span className="mx-1 h-0.5 w-2 sm:w-4 bg-white/10 rounded-full" />
                )}
              </div>
            );
          })}
        </nav>

        {/* User Identity */}
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-xs font-semibold text-white/90">
            {avatarInitials || userName.slice(0, 2).toUpperCase()}
          </div>
          <div className="hidden lg:block text-right">
            <span className="text-xs font-medium text-white block leading-tight">
              {userName}
            </span>
            <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 justify-end">
              <ShieldCheck className="size-2.5" /> Owner
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
