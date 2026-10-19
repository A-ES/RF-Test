import { redirect } from "next/navigation";
import { getRfAdminSession } from "@/lib/session";
import { isSetupAvailable } from "@/lib/setup";

export const dynamic = "force-dynamic";

/**
 * Root `/` — redirect authenticated admins into the console.
 * Unauthenticated visitors are routed to /setup if initial setup is pending,
 * or /login if already configured.
 */
export default async function AdminRootPage() {
  const session = await getRfAdminSession();
  if (!session) {
    const setupState = await isSetupAvailable();
    if (setupState.available) {
      redirect("/setup");
    }
    redirect("/login");
  }
  redirect("/console/organizations");
}
