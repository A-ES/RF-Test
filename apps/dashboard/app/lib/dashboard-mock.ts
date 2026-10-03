import type { Project } from "@/app/types/project";
import type { Insight } from "@/app/types/insight";
import type {
  RecentConversation,
  ProjectStatusCounts,
  ConversationHistoryPoint,
  InsightHistoryPoint,
  TeamRoleCounts,
} from "@/app/types/dashboard";

export type {
  ProjectStatusCounts,
  ConversationHistoryPoint,
  InsightHistoryPoint,
  TeamRoleCounts,
};

/**
 * Derives project breakdown by status from projects list or returns real DB counts.
 */
export function deriveProjectStatusCounts(
  projects: Project[],
  totalMetricValue: number,
  exactCounts?: ProjectStatusCounts
): ProjectStatusCounts {
  if (exactCounts) {
    return exactCounts;
  }

  let onTrack = 0;
  let atRisk = 0;
  let blocked = 0;
  let completed = 0;

  for (const p of projects) {
    if (p.status === "ON_TRACK") onTrack++;
    else if (p.status === "AT_RISK") atRisk++;
    else if (p.status === "BLOCKED") blocked++;
    else if (p.status === "COMPLETED") completed++;
  }

  return {
    onTrack,
    atRisk,
    blocked,
    completed,
    total: totalMetricValue || (onTrack + atRisk + blocked),
  };
}

/**
 * Derives a 7-day conversation activity chart from real conversation dates.
 * Truthful 0 counts when no conversations occurred on a given day.
 */
export function deriveConversationsHistory(
  recentConversations: RecentConversation[],
  totalCount: number,
  exactHistory?: ConversationHistoryPoint[]
): ConversationHistoryPoint[] {
  if (exactHistory && exactHistory.length > 0) {
    return exactHistory;
  }

  const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const todayIdx = (new Date().getDay() + 6) % 7; // 0 for Mon ... 6 for Sun
  const orderedDays: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const idx = (todayIdx - i + 7) % 7;
    orderedDays.push(days[idx]);
  }

  // Bucket recent conversations by day if within the past 7 days
  const now = Date.now();
  const dayMs = 86_400_000;
  const buckets = [0, 0, 0, 0, 0, 0, 0];

  for (const conv of recentConversations) {
    const diff = now - new Date(conv.updatedAt).getTime();
    const dayAgo = Math.floor(diff / dayMs);
    if (dayAgo >= 0 && dayAgo < 7) {
      buckets[6 - dayAgo]++;
    }
  }

  return orderedDays.map((day, i) => ({
    day,
    count: buckets[i] ?? 0,
  }));
}

/**
 * Derives 30-day insight volume points from real insight timestamps.
 * Truthful 0 counts when no insights exist. No synthetic curves or Math.sin.
 */
export function deriveInsightsHistory(
  insights: Array<{ createdAt: string | Date }>,
  totalCount: number,
  exactHistory?: InsightHistoryPoint[]
): InsightHistoryPoint[] {
  if (exactHistory && exactHistory.length > 0) {
    return exactHistory;
  }

  const points = 8;
  const history: InsightHistoryPoint[] = [];
  const now = Date.now();
  const intervalMs = (30 / points) * 86_400_000;

  for (let i = points - 1; i >= 0; i--) {
    const intervalEnd = now - i * intervalMs;
    const intervalStart = intervalEnd - intervalMs;
    const d = new Date(intervalEnd);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;

    // Count real insights created within this interval
    let count = 0;
    for (const ins of insights) {
      const t = new Date(ins.createdAt).getTime();
      if (t >= intervalStart && t < intervalEnd) {
        count++;
      }
    }

    history.push({
      date: label,
      count,
    });
  }

  return history;
}

/**
 * Returns team role distribution from database counts, or truthful zeros.
 */
export function deriveTeamRoles(
  totalMembers: number,
  exactRoles?: TeamRoleCounts
): TeamRoleCounts {
  if (exactRoles) {
    return exactRoles;
  }

  return {
    admin: 0,
    member: totalMembers,
    viewer: 0,
    pending: 0,
    total: totalMembers,
  };
}
