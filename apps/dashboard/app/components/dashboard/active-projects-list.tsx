"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  History,
  Activity,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Edit2,
  X,
  Check,
  User,
  ListTodo,
  Clock,
  FileText,
  FileSpreadsheet,
  Download,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import type { Project, ProjectStatus, TaskItem } from "@/app/types/project";

export interface OrgMember {
  id: string;
  name: string;
  avatarInitials?: string;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ProjectStatus,
  { label: string; dotColor: string; textColor: string; barColor: string }
> = {
  ON_TRACK: {
    label:     "On track",
    dotColor:  "var(--dash-status-running)",
    textColor: "var(--dash-status-running)",
    barColor:  "var(--dash-status-running)",
  },
  AT_RISK: {
    label:     "At risk",
    dotColor:  "var(--dash-status-paused)",
    textColor: "var(--dash-status-paused)",
    barColor:  "var(--dash-status-paused)",
  },
  BLOCKED: {
    label:     "Blocked",
    dotColor:  "var(--dash-status-error)",
    textColor: "var(--dash-status-error)",
    barColor:  "var(--dash-status-error)",
  },
  COMPLETED: {
    label:     "Completed",
    dotColor:  "var(--dash-status-completed)",
    textColor: "var(--text-muted)",
    barColor:  "var(--dash-status-completed)",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDueDate(iso: string): string {
  const date = new Date(iso);
  const now  = new Date();
  const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0)   return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Due today";
  if (diff <= 7)  return `${diff}d left`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isDueSoon(iso: string): boolean {
  const diff = (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff <= 7;
}

function toIso(dateStr: string): string {
  return new Date(dateStr + "T00:00:00.000Z").toISOString();
}

function formatTimestamp(isoStr?: string): string {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoStr;
  }
}

function formatRelativeUpdated(isoStr?: string): string {
  if (!isoStr) return "";
  try {
    const date = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return "just now";
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ActiveProjectsListProps {
  projects: Project[];
  members?: OrgMember[];
  /** When true, renders inside the /projects page (no "View all" link) */
  standalone?: boolean;
  /** Callback when user clicks "Edit" on a project */
  onEditProject?: (project: Project) => void;
  /** Callback when a project is updated locally/via API */
  onProjectUpdated?: (updatedProject: Project) => void;
}

export function ActiveProjectsList({
  projects,
  members = [],
  standalone = false,
  onEditProject,
  onProjectUpdated,
}: ActiveProjectsListProps) {
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  // New subtask state per project
  const [newTaskTitle, setNewTaskTitle]         = useState<Record<string, string>>({});
  const [newTaskAssignee, setNewTaskAssignee]   = useState<Record<string, string>>({});
  const [newTaskDueDate, setNewTaskDueDate]     = useState<Record<string, string>>({});
  const [isAddingTask, setIsAddingTask]         = useState<Record<string, boolean>>({});
  const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null);

  // Editing subtask state
  const [editingTask, setEditingTask] = useState<{
    projectId: string;
    task: TaskItem;
    title: string;
    assigneeId: string;
    dueDate: string;
  } | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedProjectId((prev) => (prev === id ? null : id));
  };

  // ── Subtask Toggle Handler ──
  const handleToggleTaskStatus = async (project: Project, task: TaskItem) => {
    const newStatus = task.status === "DONE" ? "TODO" : "DONE";
    setSubmittingTaskId(task.id);

    try {
      const res = await fetch(`/api/projects/${project.id}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error("Failed to update task status");
      const data = (await res.json()) as { project: Project };
      if (onProjectUpdated) {
        onProjectUpdated(data.project);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingTaskId(null);
    }
  };

  // ── Add Subtask Handler ──
  const handleAddSubtask = async (projectId: string, e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle[projectId]?.trim();
    if (!title) return;

    setSubmittingTaskId(`new_${projectId}`);

    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          assigneeId: newTaskAssignee[projectId] || undefined,
          dueDate: newTaskDueDate[projectId] ? toIso(newTaskDueDate[projectId]) : undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to add subtask");
      const data = (await res.json()) as { project: Project };

      if (onProjectUpdated) {
        onProjectUpdated(data.project);
      }

      // Reset form for this project
      setNewTaskTitle((prev) => ({ ...prev, [projectId]: "" }));
      setNewTaskAssignee((prev) => ({ ...prev, [projectId]: "" }));
      setNewTaskDueDate((prev) => ({ ...prev, [projectId]: "" }));
      setIsAddingTask((prev) => ({ ...prev, [projectId]: false }));
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingTaskId(null);
    }
  };

  // ── Edit Subtask Submit Handler ──
  const handleSaveEditTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask || !editingTask.title.trim()) return;

    const { projectId, task, title, assigneeId, dueDate } = editingTask;
    setSubmittingTaskId(task.id);

    try {
      const res = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          assigneeId: assigneeId || null,
          dueDate: dueDate ? toIso(dueDate) : null,
        }),
      });

      if (!res.ok) throw new Error("Failed to edit task");
      const data = (await res.json()) as { project: Project };

      if (onProjectUpdated) {
        onProjectUpdated(data.project);
      }

      setEditingTask(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingTaskId(null);
    }
  };

  // ── Delete Subtask Handler ──
  const handleDeleteTask = async (projectId: string, taskId: string) => {
    setSubmittingTaskId(taskId);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete task");
      const data = (await res.json()) as { project: Project };

      if (onProjectUpdated) {
        onProjectUpdated(data.project);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingTaskId(null);
    }
  };

  return (
    <section aria-labelledby="active-projects-heading">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="dash-eyebrow">/ active projects</p>
          <h2
            id="active-projects-heading"
            className="mt-0.5 text-sm font-semibold text-[var(--text-primary)]"
          >
            {projects.length} in progress
          </h2>
        </div>
        {!standalone && (
          <Link
            href="/projects"
            className="flex items-center gap-1 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors group"
          >
            View all
            <ArrowUpRight
              aria-hidden
              className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] italic py-4 text-center">
          No projects yet. Create your first one above.
        </p>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => {
            const cfg        = STATUS_CONFIG[project.status];
            const dueSoon    = isDueSoon(project.dueDate);
            const dueLabel   = formatDueDate(project.dueDate);
            const isExpanded = expandedProjectId === project.id;
            const initials   = project.ownerInitials ?? project.ownerName.slice(0, 2).toUpperCase();

            // Derive progress dynamically
            const tasks          = project.tasks ?? [];
            const totalTasks     = tasks.length;
            const completedTasks = tasks.filter((t) => t.status === "DONE").length;
            const liveProgress   = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            const hasTasks       = totalTasks > 0;

            return (
              <div
                key={project.id}
                className={cn(
                  "group rounded-lg border transition-all duration-200 overflow-hidden",
                  isExpanded
                    ? "border-[var(--border-strong)] bg-[var(--surface-elevated)]"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]"
                )}
              >
                {/* Main row */}
                <div className="p-3.5 select-none">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div
                      onClick={() => toggleExpand(project.id)}
                      className="min-w-0 flex items-center gap-2 cursor-pointer flex-1"
                    >
                      <button
                        type="button"
                        aria-label="Toggle drawer"
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-0.5"
                      >
                        {isExpanded ? (
                          <ChevronUp className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </button>
                      <div>
                        <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                          {project.name}
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                          {project.accountName}
                        </p>
                      </div>
                    </div>

                    {/* Status badge + Edit action */}
                    <div className="flex items-center gap-2 shrink-0">
                      {onEditProject && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditProject(project);
                          }}
                          className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] transition-colors"
                          title="Edit project details"
                        >
                          <Edit2 className="size-3" />
                          <span>Edit</span>
                        </button>
                      )}
                      <span
                        className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[10px] font-mono tracking-wide uppercase"
                        style={{
                          background: `${cfg.dotColor}18`,
                          color: cfg.textColor,
                        }}
                      >
                        <span
                          aria-hidden
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: cfg.dotColor }}
                        />
                        {cfg.label}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar / Neutral state */}
                  <div className="mb-2.5">
                    {hasTasks ? (
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[10px] font-mono text-[var(--text-muted)]">
                          <span>Progress ({liveProgress}%)</span>
                          <span>{completedTasks}/{totalTasks} tasks done</span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuenow={liveProgress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${project.name} progress`}
                          className="h-1.5 w-full rounded-full bg-[var(--surface-elevated)] overflow-hidden"
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${liveProgress}%`,
                              background: cfg.barColor,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between py-0.5 text-[11px] text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded px-2.5 bg-[var(--surface)]/30">
                        <span className="flex items-center gap-1.5 italic">
                          <ListTodo className="size-3.5 text-[var(--text-muted)]" />
                          No subtasks assigned yet
                        </span>
                        <span className="text-[10px] font-mono">0 tasks</span>
                      </div>
                    )}
                  </div>

                  {/* Footer row */}
                  <div
                    onClick={() => toggleExpand(project.id)}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    {/* Owner */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold font-mono"
                        style={{
                          background: "var(--surface-elevated)",
                          color: "var(--text-secondary)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {initials}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {project.ownerName}
                      </span>
                    </div>

                    {/* Due date + task count + updatedAt + activity hint */}
                    <div className="flex items-center gap-3">
                      {project.updatedAt && (
                        <span
                          className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] font-mono"
                          title={`Last updated: ${formatTimestamp(project.updatedAt)}`}
                        >
                          <Clock aria-hidden className="size-3 text-[var(--accent)]" />
                          <span>Updated {formatRelativeUpdated(project.updatedAt)}</span>
                        </span>
                      )}
                      <span className="text-[11px] text-[var(--text-muted)] font-mono">
                        {totalTasks - completedTasks} open / {totalTasks} total
                      </span>
                      <span
                        className={cn(
                          "flex items-center gap-1 text-[11px]",
                          dueSoon && project.status !== "COMPLETED"
                            ? "text-[var(--dash-status-paused)]"
                            : "text-[var(--text-muted)]"
                        )}
                      >
                        <CalendarClock aria-hidden className="size-3" />
                        {dueLabel}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded-xs flex items-center gap-1">
                        <History className="size-3" />
                        {project.activities?.length ?? 0} activities
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expandable Subtasks & Activity Drawer */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)] bg-[var(--surface)]/50 p-4 space-y-5 animate-in slide-in-from-top-1 duration-150">
                    {/* ── Project Metadata & Timestamps ── */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border)] text-[11px]">
                      <div className="flex items-center gap-3 font-mono">
                        {project.updatedAt && (
                          <span
                            className="flex items-center gap-1.5 text-[var(--text-secondary)]"
                            title={project.updatedAt}
                          >
                            <Clock className="size-3 text-[var(--accent)]" />
                            <span className="font-semibold text-[var(--text-primary)]">Last updated:</span>{" "}
                            {formatTimestamp(project.updatedAt)}
                          </span>
                        )}
                        {project.createdAt && (
                          <span className="text-[var(--text-muted)]">
                            Created:{" "}
                            {new Date(project.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                        <span>{(project.documents?.length ?? 0) + (project.reports?.length ?? 0)} files</span>
                        <span>·</span>
                        <span>{project.insights?.length ?? 0} insights</span>
                      </div>
                    </div>
                    {/* ── Subtasks Section ── */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                          <ListTodo className="size-3.5 text-[var(--accent)]" />
                          Project Subtasks
                        </h4>
                        <button
                          type="button"
                          onClick={() =>
                            setIsAddingTask((prev) => ({ ...prev, [project.id]: !prev[project.id] }))
                          }
                          className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium transition-colors"
                        >
                          <Plus className="size-3.5" />
                          Add Task
                        </button>
                      </div>

                      {/* Subtask list */}
                      {tasks.length > 0 ? (
                        <div className="space-y-1.5">
                          {tasks.map((task) => {
                            const isDone = task.status === "DONE";
                            const isEditingThis = editingTask?.task.id === task.id;

                            if (isEditingThis && editingTask) {
                              return (
                                <form
                                  key={task.id}
                                  onSubmit={handleSaveEditTask}
                                  className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-[var(--accent)] bg-[var(--surface-elevated)] text-xs"
                                >
                                  <input
                                    type="text"
                                    value={editingTask.title}
                                    onChange={(e) =>
                                      setEditingTask((prev) => prev ? { ...prev, title: e.target.value } : null)
                                    }
                                    placeholder="Task title"
                                    className="flex-1 min-w-[150px] rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
                                    autoFocus
                                  />
                                  <select
                                    value={editingTask.assigneeId}
                                    onChange={(e) =>
                                      setEditingTask((prev) => prev ? { ...prev, assigneeId: e.target.value } : null)
                                    }
                                    className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
                                  >
                                    <option value="">No assignee</option>
                                    {members.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.name}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="date"
                                    value={editingTask.dueDate}
                                    onChange={(e) =>
                                      setEditingTask((prev) => prev ? { ...prev, dueDate: e.target.value } : null)
                                    }
                                    className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
                                  />
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="submit"
                                      disabled={submittingTaskId === task.id}
                                      className="p-1 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                                      title="Save task"
                                    >
                                      <Check className="size-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingTask(null)}
                                      className="p-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                      title="Cancel"
                                    >
                                      <X className="size-3.5" />
                                    </button>
                                  </div>
                                </form>
                              );
                            }

                            return (
                              <div
                                key={task.id}
                                className={cn(
                                  "group/task flex items-center justify-between gap-2 p-2 rounded-md border text-xs transition-colors",
                                  isDone
                                    ? "border-[var(--border)]/50 bg-[var(--surface)]/30 text-[var(--text-muted)]"
                                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
                                )}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <button
                                    type="button"
                                    disabled={submittingTaskId === task.id}
                                    onClick={() => handleToggleTaskStatus(project, task)}
                                    className="text-[var(--accent)] hover:scale-105 transition-transform shrink-0"
                                    aria-label={isDone ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                                  >
                                    {isDone ? (
                                      <CheckSquare className="size-4 text-[var(--dash-status-running)]" />
                                    ) : (
                                      <Square className="size-4 text-[var(--text-muted)] hover:text-[var(--accent)]" />
                                    )}
                                  </button>
                                  <span className={cn("truncate font-medium", isDone && "line-through opacity-70")}>
                                    {task.title}
                                  </span>
                                </div>

                                {/* Assignee + Due Date + Actions */}
                                <div className="flex items-center gap-2 shrink-0">
                                  {task.assigneeName && (
                                    <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] bg-[var(--surface-elevated)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                                      <User className="size-2.5" />
                                      {task.assigneeName}
                                    </span>
                                  )}
                                  {task.dueDate && (
                                    <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] bg-[var(--surface-elevated)] px-1.5 py-0.5 rounded border border-[var(--border)] font-mono">
                                      <CalendarClock className="size-2.5" />
                                      {new Date(task.dueDate).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </span>
                                  )}

                                  <div className="opacity-0 group-hover/task:opacity-100 transition-opacity flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingTask({
                                          projectId: project.id,
                                          task,
                                          title: task.title,
                                          assigneeId: task.assigneeId || "",
                                          dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
                                        })
                                      }
                                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] transition-colors"
                                      title="Edit task"
                                    >
                                      <Edit2 className="size-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteTask(project.id, task.id)}
                                      disabled={submittingTaskId === task.id}
                                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--dash-status-error)] hover:bg-[var(--surface-elevated)] transition-colors"
                                      title="Delete task"
                                    >
                                      <Trash2 className="size-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)] italic py-1">
                          No subtasks added yet. Click "Add Task" to create one.
                        </p>
                      )}

                      {/* Add subtask inline form */}
                      {isAddingTask[project.id] && (
                        <form
                          onSubmit={(e) => handleAddSubtask(project.id, e)}
                          className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-[var(--accent)] bg-[var(--surface-elevated)] text-xs animate-in fade-in duration-100"
                        >
                          <input
                            type="text"
                            value={newTaskTitle[project.id] || ""}
                            onChange={(e) =>
                              setNewTaskTitle((prev) => ({ ...prev, [project.id]: e.target.value }))
                            }
                            placeholder="Subtask title (e.g. Complete security audit)"
                            className="flex-1 min-w-[180px] rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                            autoFocus
                          />
                          <select
                            value={newTaskAssignee[project.id] || ""}
                            onChange={(e) =>
                              setNewTaskAssignee((prev) => ({ ...prev, [project.id]: e.target.value }))
                            }
                            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
                          >
                            <option value="">Assignee (Optional)</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="date"
                            value={newTaskDueDate[project.id] || ""}
                            onChange={(e) =>
                              setNewTaskDueDate((prev) => ({ ...prev, [project.id]: e.target.value }))
                            }
                            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
                          />
                          <div className="flex items-center gap-1">
                            <button
                              type="submit"
                              disabled={submittingTaskId === `new_${project.id}`}
                              className="rounded bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setIsAddingTask((prev) => ({ ...prev, [project.id]: false }))
                              }
                              className="p-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </form>
                      )}
                    </div>

                    {/* ── Documents & Reports Section ── */}
                    <div className="space-y-3 pt-3 border-t border-[var(--border)]">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                          <FileText className="size-3.5 text-[var(--accent)]" />
                          Documents &amp; Reports
                        </h4>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          {(project.documents?.length ?? 0) + (project.reports?.length ?? 0)} attached
                        </span>
                      </div>

                      {((project.documents && project.documents.length > 0) || (project.reports && project.reports.length > 0)) ? (
                        <div className="space-y-2">
                          {/* Documents */}
                          {project.documents?.map((doc) => (
                            <div
                              key={doc.id}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-xs hover:bg-[var(--surface-elevated)] transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="size-7 rounded bg-[var(--surface-elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shrink-0">
                                  <FileText className="size-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-[var(--text-primary)] text-xs">
                                    {doc.fileName}
                                  </p>
                                  <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] font-mono">
                                    <span>{doc.fileSize}</span>
                                    <span>·</span>
                                    <span>
                                      {new Date(doc.createdAt).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {/* Processing status indicator */}
                                {doc.processingStatus === "PENDING" && (
                                  <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    <Loader2 className="size-2.5 animate-spin" />
                                    Processing
                                  </span>
                                )}
                                {doc.processingStatus === "PROCESSED" && (
                                  <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    <CheckCircle2 className="size-2.5" />
                                    Processed
                                  </span>
                                )}
                                {doc.processingStatus === "FAILED" && (
                                  <span
                                    title={doc.failureReason ?? "Processing failed"}
                                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20 cursor-help"
                                  >
                                    <AlertCircle className="size-2.5" />
                                    Failed
                                  </span>
                                )}

                                {/* Working view/download link using existing secure download endpoint */}
                                <a
                                  href={`/api/documents/${doc.id}/download`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  download={doc.fileName}
                                  className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] hover:border-[var(--accent)] transition-colors"
                                  title={`Download ${doc.fileName}`}
                                >
                                  <Download className="size-3" />
                                  <span>Download</span>
                                </a>
                              </div>
                            </div>
                          ))}

                          {/* Reports */}
                          {project.reports?.map((rep) => (
                            <div
                              key={rep.id}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-xs hover:bg-[var(--surface-elevated)] transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="size-7 rounded bg-[var(--surface-elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shrink-0">
                                  <FileSpreadsheet className="size-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-[var(--text-primary)] text-xs">
                                    {rep.title}
                                  </p>
                                  <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] font-mono">
                                    <span className="uppercase text-[var(--accent)]">{rep.type}</span>
                                    <span>·</span>
                                    <span>{rep.size}</span>
                                    <span>·</span>
                                    <span>
                                      {new Date(rep.createdAt).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {/* Report status indicator */}
                                {rep.status === "READY" && (
                                  <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    <CheckCircle2 className="size-2.5" />
                                    Ready
                                  </span>
                                )}
                                {rep.status === "PROCESSING" && (
                                  <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    <Loader2 className="size-2.5 animate-spin" />
                                    Processing
                                  </span>
                                )}
                                {rep.status === "FAILED" && (
                                  <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                    <AlertCircle className="size-2.5" />
                                    Failed
                                  </span>
                                )}

                                {rep.fileUrl ? (
                                  <a
                                    href={rep.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download
                                    className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] hover:border-[var(--accent)] transition-colors"
                                    title={`Download ${rep.title}`}
                                  >
                                    <Download className="size-3" />
                                    <span>Export</span>
                                  </a>
                                ) : (
                                  <span className="text-[10px] font-mono text-[var(--text-muted)] px-1">
                                    No file
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)] italic py-1">
                          No documents or reports attached to this project.
                        </p>
                      )}
                    </div>

                    {/* ── Linked AI Insights Section ── */}
                    <div className="space-y-3 pt-3 border-t border-[var(--border)]">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                          <Sparkles className="size-3.5 text-[var(--accent)]" />
                          Linked AI Insights
                        </h4>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          {project.insights?.length ?? 0} linked
                        </span>
                      </div>

                      {project.insights && project.insights.length > 0 ? (
                        <div className="space-y-2">
                          {project.insights.map((ins) => (
                            <div
                              key={ins.id}
                              className="p-2.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-xs space-y-1 hover:bg-[var(--surface-elevated)] transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-[var(--text-primary)]">
                                  {ins.title}
                                </span>
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider",
                                    ins.severity === "CRITICAL"
                                      ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                      : ins.severity === "HIGH"
                                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                      : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                  )}
                                >
                                  {ins.severity}
                                </span>
                              </div>
                              {ins.recommendedAction && (
                                <p className="text-[11px] text-[var(--text-secondary)]">
                                  Action: {ins.recommendedAction}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)] italic py-1">
                          No AI insights linked to this project.
                        </p>
                      )}
                    </div>

                    {/* ── Activity History Section ── */}
                    <div className="space-y-3 pt-3 border-t border-[var(--border)]">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                          <Activity className="size-3.5 text-[var(--accent)]" />
                          Activity History
                        </h4>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          Latest Updates
                        </span>
                      </div>

                      {project.activities && project.activities.length > 0 ? (
                        <div className="space-y-2 relative pl-2 before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-px before:bg-[var(--border)]">
                          {project.activities.map((act) => (
                            <div key={act.id} className="relative pl-6 text-xs space-y-0.5">
                              <div className="absolute left-0 top-1 size-3 rounded-full border border-[var(--border-strong)] bg-[var(--surface-elevated)] flex items-center justify-center">
                                <span className="size-1 rounded-full bg-[var(--accent)]" />
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-medium text-[var(--text-primary)]">
                                  {act.author} ({act.authorInitials})
                                </span>
                                <span className="text-[10px] text-[var(--text-muted)] font-mono">
                                  {act.timestamp}
                                </span>
                              </div>
                              <p className="text-[var(--text-secondary)]">{act.action}</p>
                              {act.details && (
                                <p className="text-[11px] text-[var(--text-muted)] bg-[var(--surface-elevated)] p-1.5 rounded-md mt-1 border border-[var(--border)]">
                                  {act.details}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)] italic">
                          No recent activity recorded for this project.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
