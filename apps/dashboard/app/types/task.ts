export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type TaskPriority = "HIGH" | "MEDIUM" | "LOW";

export interface TaskDto {
  id: string;
  title: string;
  cleanTitle: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  project: {
    id: string;
    name: string;
    accountName: string;
  } | null;
  assignee: {
    id: string;
    name: string;
    avatarInitials: string;
  } | null;
  sourceInsight: {
    id: string;
    title: string;
    type: string;
    severity: string;
  } | null;
}

export interface TasksResponse {
  tasks: TaskDto[];
  total: number;
  openCount: number;
  doneCount: number;
}
