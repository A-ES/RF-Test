import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getRfAdminSession } from "@/lib/session";
import { isSetupAvailable } from "@/lib/setup";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * The unauthenticated sign-in page. It renders the two-step sign-in form
 * or links to the setup wizard if initial setup is pending.
 */
export default async function LoginPage() {
  let session = null;
  let setupState = { available: false };

  try {
    session = await getRfAdminSession();
    if (session) redirect("/");
    setupState = await isSetupAvailable();
  } catch (error: any) {
    if (error?.digest?.startsWith("NEXT_REDIRECT") || error?.message === "NEXT_REDIRECT") {
      throw error;
    }
    console.error("LoginPage error:", error);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6" style={{ background: "var(--console-frame)" }}>
      <LoginForm setupAvailable={setupState.available} />
    </main>
  );
}
