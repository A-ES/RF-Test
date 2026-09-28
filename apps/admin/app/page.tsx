import { redirect } from "next/navigation";
import { getRfAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Root `/` — redirect authenticated admins into the console.
 * Unauthenticated visitors are bounced to /login by the layout guard, but we
 * also check here so the root URL is never a dead end.
 */
export default async function AdminRootPage() {
  const session = await getRfAdminSession();
  if (!session) redirect("/login");
  redirect("/console/organizations");
}
