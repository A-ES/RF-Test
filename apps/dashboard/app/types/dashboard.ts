/**
 * Canonical types for the GET /api/dashboard response.
 * No mock-data shapes leak through here — these mirror DB-derived values only.
 */

import type { Insight } from "@/app/types/insight";
import type { Project } from "@/app/types/project";

// ─── Metric cards ─────────────────────────────────────────────────────────────

export type TrendDirection = "up" | "down" | "flat";
export type ChipColor = "red" | "blue" | "green" | "amber" | "violet";
export type MetricIconKey =
  | "folder-kanban"
  | "messages-square"
  | "sparkles"
  | "users"
  | "trending-up";

export interface MetricCard {
  id: string;
  label: string;
  value: string;
  rawValue: number;
  delta: string;
  deltaValue: number;
  trend: TrendDirection;
  chipColor: ChipColor;
  iconKey: MetricIconKey;
  period: string;
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "warning" | "info";

export interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  dismissible: boolean;
}

// ─── Recent conversations (displayed as "messages") ───────────────────────────

export interface RecentConversation {
  id: string;
  /** Used as sender name in the UI */
  senderName: string;
  senderInitials: string;
  /** Last message preview */
  preview: string;
  relativeTime: string;
  /** ISO timestamp of last activity */
  updatedAt: string;
  /** True when conversation.unread === true */
  unread: boolean;
  /** Conversation topic shown as context label */
  contextLabel: string;
}

// ─── Visual Breakdown & Telemetry ───────────────────────────────────────────

export interface ProjectStatusCounts {
  onTrack: number;
  atRisk: number;
  blocked: number;
  completed: number;
  total: number;
}

export interface AIProcessStats {
  queued: number;
  processing: number;
  activeConversations: number;
  completed: number;
  failed: number;
  total: number;
  /** Legacy alias for queued + processing + activeConversations */
  active: number;
}

export interface PendingActionStats {
  actionableTasks: number;
  reviewSignals: number;
  openTasks: number;
  escalations: number;
  unreadInsights: number;
  atRiskProjects: number;
  total: number;
}

export interface DashboardActivity {
  id: string;
  authorName: string;
  authorInitials: string;
  projectName: string;
  action: string;
  details?: string | null;
  type: "status" | "comment" | "task" | "milestone";
  relativeTime: string;
  createdAt: string;
}

export interface InsightHistoryPoint {
  date: string;
  count: number;
}

export interface ConversationHistoryPoint {
  day: string;
  count: number;
}

export interface TeamRoleCounts {
  admin: number;
  member: number;
  viewer: number;
  pending: number;
  total: number;
}

// ─── Dashboard API response ───────────────────────────────────────────────────

export interface SectionErrors {
  projects?: boolean;
  insights?: boolean;
  metrics?: boolean;
  alerts?: boolean;
  conversations?: boolean;
  activities?: boolean;
  counts?: {
    projects?: boolean;
    conversations?: boolean;
    insights?: boolean;
    renewal?: boolean;
    team?: boolean;
    aiProcesses?: boolean;
    pendingActions?: boolean;
  };
}

export interface DashboardData {
  /** Greeting name from the signed-in user's profile */
  userName: string;
  metricCards: MetricCard[];
  /** Up to 5 most-recently-updated projects */
  projects: Project[];
  /** Exact project status distribution from database */
  projectStatusCounts?: ProjectStatusCounts;
  /** AI processes and tasks breakdown */
  aiProcessStats?: AIProcessStats;
  /** Pending actions requiring human attention */
  pendingActionStats?: PendingActionStats;
  /** Recent system and project activities */
  recentActivities?: DashboardActivity[];
  /** Up to 5 most-recent insights */
  insights: Insight[];
  unreadInsightCount: number;
  /** Real 30-day insight generation points */
  insightHistory?: InsightHistoryPoint[];
  alerts: DashboardAlert[];
  /** Up to 5 most-recently-updated conversations */
  recentConversations: RecentConversation[];
  /** Real 7-day conversation message points */
  conversationHistory?: ConversationHistoryPoint[];
  /** Real database user role breakdown */
  teamRoles?: TeamRoleCounts;
  /** Per-section error flags indicating which sections failed to load (e.g. timeout or P1001) */
  errors?: SectionErrors;
}
