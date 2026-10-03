/**
 * Canonical project types shared between the Projects page and components.
 * These mirror the API response shape from GET/POST /api/projects.
 */

export type ProjectStatus = "ON_TRACK" | "AT_RISK" | "BLOCKED" | "COMPLETED";

export interface TaskItem {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
}

export interface ProjectActivity {
  id: string;
  timestamp: string;
  author: string;
  authorInitials: string;
  action: string;
  details?: string;
  type: "status" | "comment" | "task" | "milestone";
}

export interface ProjectDocument {
  id: string;
  fileName: string;
  fileSize: string;
  fileUrl: string;
  mimeType?: string | null;
  processingStatus: "PENDING" | "PROCESSED" | "FAILED";
  extractedEntitiesCount?: number;
  failureReason?: string | null;
  createdAt: string;
}

export interface ProjectReport {
  id: string;
  title: string;
  type: string;
  size: string;
  status: "READY" | "PROCESSING" | "FAILED";
  fileUrl?: string | null;
  createdAt: string;
}

export interface ProjectInsight {
  id: string;
  title: string;
  type: string;
  severity: string;
  recommendedAction?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  accountName: string;
  status: ProjectStatus;
  /** 0–100 */
  progress: number;
  /** ISO 8601 date-time string */
  dueDate: string;
  /** ISO 8601 date-time string */
  createdAt: string;
  /** ISO 8601 date-time string */
  updatedAt: string;
  openTasksCount: number;
  ownerId: string;
  ownerName: string;
  /** Populated client-side from ownerName initials; not returned by API */
  ownerInitials?: string;
  tasks: TaskItem[];
  activities?: ProjectActivity[];
  documents?: ProjectDocument[];
  reports?: ProjectReport[];
  insights?: ProjectInsight[];
}

/** Derive two-letter initials from a full name */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
