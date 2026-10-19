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
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex flex-col items-center gap-6">
        {setupState.available ? (
          <Link
            href="/setup"
            className="flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-xs font-medium text-accent hover:bg-accent/20 transition-all shadow-md"
          >
            <Sparkles className="size-3.5" />
            <span>First time setup? Configure your admin account &rarr;</span>
          </Link>
        ) : null}
        <LoginForm />
        <p className="max-w-sm text-center text-[11px] leading-relaxed text-text-muted">
          Access is restricted to authorised RF Intelligence staff. All sign-in
          attempts are logged.
        </p>
      </div>
    </main>
  );
}
