import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRfAdminSession } from "@/lib/session";
import { isSetupAvailable } from "@/lib/setup";
import { SetupWizard } from "./setup-wizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Setup & Onboarding",
  robots: { index: false, follow: false },
};

export default async function SetupPage() {
  try {
    const session = await getRfAdminSession();
    if (session) {
      redirect("/console/organizations");
    }

    const setupState = await isSetupAvailable();
    if (!setupState.available) {
      redirect("/login");
    }
  } catch (error: any) {
    if (error?.digest?.startsWith("NEXT_REDIRECT") || error?.message === "NEXT_REDIRECT") {
      throw error;
    }
    console.error("SetupPage check error:", error);
    // Proceed to render SetupWizard so user can complete setup
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6" style={{ background: "var(--console-frame)" }}>
      <SetupWizard />
    </main>
  );
}
