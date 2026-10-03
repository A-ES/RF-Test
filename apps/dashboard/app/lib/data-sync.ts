import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel } from "@/app/lib/realtime/channels";
import { invalidateDashboardCache } from "@/app/api/dashboard/route";
import { invalidateNotificationsCache } from "@/app/api/notifications/route";
import { revalidateTag } from "next/cache";

export type DashboardSection =
  | "projects"
  | "tasks"
  | "insights"
  | "conversations"
  | "reports"
  | "documents"
  | "messages"
  | "team"
  | "account"
  | "alerts";

// In-memory per-org data version tracker
const orgDataVersions = new Map<string, number>();

export function getOrgDataVersion(orgId: string): number {
  return orgDataVersions.get(orgId) ?? 1;
}

/**
 * Notifies the system that organization data has changed.
 * (a) Bumps the organization's data version (for cache invalidation).
 * (b) Publishes a realtime event on the existing realtime channel.
 * (c) Revalidates dashboard cache, notification cache, and Next.js tags.
 */
export async function notifyOrgDataChanged(
  orgId: string,
  sections: DashboardSection[],
): Promise<void> {
  if (!orgId) return;

  // 1. Bump data version
  const currentVer = orgDataVersions.get(orgId) ?? 1;
  const nextVer = currentVer + 1;
  orgDataVersions.set(orgId, nextVer);

  // 2. Invalidate server-side in-memory dashboard and notification caches
  invalidateDashboardCache(orgId);
  invalidateNotificationsCache();

  // 3. Revalidate Next.js cache tags
  try {
    const reval = revalidateTag as unknown as (tag: string, profile?: string) => void;
    reval(`org-${orgId}`, "max");
    reval(`dashboard-${orgId}`, "max");
  } catch {
    // Non-fatal if called outside Next.js request context
  }

  // 4. Publish realtime event to notifications / messages channel
  try {
    const channel = orgChannel(orgId, "notifications");
    await publishToChannel(channel, "org:data-changed", {
      orgId,
      dataVersion: nextVer,
      sections,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn("notifyOrgDataChanged: realtime publish failed", err);
  }
}
