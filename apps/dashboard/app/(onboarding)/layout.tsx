import { ReactNode } from "react";
import { getSession } from "@/app/lib/session";
import { redirect } from "next/navigation";
import { getOrganizationOnboardingStatus } from "@/app/lib/payment/service";
import { OnboardingNav } from "@/app/components/onboarding/onboarding-nav";

export const metadata = {
  title: "Onboarding — RF Intelligence",
  description: "Set up your RF Intelligence wholesale workspace.",
};

export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const status = await getOrganizationOnboardingStatus(session.organizationId);

  return (
    <div className="min-h-screen bg-[#05060A] text-[#F5F5F0] flex flex-col selection:bg-[#F24E4B] selection:text-white">
      {/* Top Navigation Bar with Step Indicator */}
      <OnboardingNav
        userName={session.name}
        userEmail={session.email}
        avatarInitials={session.avatarInitials}
        orgName={status.companyName || session.organization?.name || "Workspace"}
        currentStep={status.currentStep}
        hasActiveSubscription={status.hasActiveSubscription}
      />

      {/* Main content stage */}
      <main className="flex-1 flex flex-col justify-center py-8 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-5xl mx-auto">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 border-t border-white/5 text-center text-xs text-white/40">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between px-4 gap-2">
          <span>RF Intelligence Platform &copy; {new Date().getFullYear()}</span>
          <span className="font-mono text-[11px] text-white/30">
            TENANT ISOLATED &bull; ZERO DATA LEAKAGE GUARANTEED
          </span>
        </div>
      </footer>
    </div>
  );
}
