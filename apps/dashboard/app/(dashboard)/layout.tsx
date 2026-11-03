import { getSession } from "@/app/lib/session";
import { redirect } from "next/navigation";
import { getOrganizationOnboardingStatus } from "@/app/lib/payment/service";
import { DashboardShell } from "@/app/components/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Enforce onboarding & subscription guardrails (prevents URL bypass)
  const status = await getOrganizationOnboardingStatus(session.organizationId);

  if (!status.completed) {
    if (!status.hasActiveSubscription) {
      redirect("/onboarding/plan");
    }

    switch (status.currentStep) {
      case 1:
        redirect("/onboarding/plan");
      case 2:
        redirect("/onboarding/checkout");
      case 3:
        redirect("/onboarding/identity");
      case 4:
        redirect("/onboarding/business");
      case 5:
        redirect("/onboarding/team");
      case 6:
        redirect("/onboarding/presentation");
      default:
        redirect("/onboarding/plan");
    }
  }

  return <DashboardShell>{children}</DashboardShell>;
}
