import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRfAdminSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * The only unauthenticated page in the console. It renders the two-step sign-in
 * form, and redirects an already-authenticated admin to the placeholder.
 */
export default async function LoginPage() {
  const session = await getRfAdminSession();
  if (session) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex flex-col items-center gap-6">
        <LoginForm />
        <p className="max-w-sm text-center text-[11px] leading-relaxed text-text-muted">
          Access is restricted to authorised RF Intelligence staff. All sign-in
          attempts are logged.
        </p>
      </div>
    </main>
  );
}
