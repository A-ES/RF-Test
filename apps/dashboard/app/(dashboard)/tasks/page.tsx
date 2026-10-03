"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckSquare,
  Square,
  Sparkles,
  FolderKanban,
  Calendar,
  Clock,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  X,
  Loader2,
} from "lucide-react";
import type { TaskDto, TaskPriority, TaskStatus, TasksResponse } from "@/app/types/task";
import { cn } from "@/app/lib/utils";

interface ProjectOption {
  id: string;
  name: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = React.useState<TaskDto[]>([]);
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = React.useState<"all" | "open" | "done">("open");
  const [sourceFilter, setSourceFilter] = React.useState<"all" | "insight" | "independent" | "project">("all");
  const [searchQuery, setSearchQuery] = React.useState("");

  // Modal state
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [createTitle, setCreateTitle] = React.useState("");
  const [createDescription, setCreateDescription] = React.useState("");
  const [createPriority, setCreatePriority] = React.useState<TaskPriority>("MEDIUM");
  const [createProjectId, setCreateProjectId] = React.useState<string>("");
  const [createDueDate, setCreateDueDate] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const fetchTasks = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error("Failed to load tasks");
      const data: TasksResponse = await res.json();
      setTasks(data.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProjects = React.useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.projects)
          ? data.projects.map((p: any) => ({ id: p.id, name: p.name }))
          : [];
        setProjects(list);
      }
    } catch {
      // Non-critical: project dropdown falls back to empty
    }
  }, []);

  React.useEffect(() => {
    void fetchTasks();
    void fetchProjects();
  }, [fetchTasks, fetchProjects]);

  const handleToggleStatus = async (task: TaskDto) => {
    const newStatus: TaskStatus = task.status === "DONE" ? "TODO" : "DONE";
    setTogglingId(task.id);

    // Optimistic UI update
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t))
    );

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      const data = await res.json();
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: data.task.status } : t))
      );
    } catch (err) {
      // Rollback on error
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t))
      );
      console.error(err);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;

    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete task");
    } catch (err) {
      void fetchTasks();
      console.error(err);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle.trim(),
          description: createDescription.trim() || undefined,
          priority: createPriority,
          projectId: createProjectId || undefined,
          dueDate: createDueDate ? new Date(createDueDate).toISOString() : undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to create task");
      const data = await res.json();
      setTasks((prev) => [data.task, ...prev]);

      // Reset form
      setCreateTitle("");
      setCreateDescription("");
      setCreatePriority("MEDIUM");
      setCreateProjectId("");
      setCreateDueDate("");
      setIsCreateOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  // Filter tasks
  const filteredTasks = React.useMemo(() => {
    return tasks.filter((task) => {
      // Status filter
      if (statusFilter === "open" && task.status === "DONE") return false;
      if (statusFilter === "done" && task.status !== "DONE") return false;

      // Source filter
      if (sourceFilter === "insight" && !task.sourceInsight) return false;
      if (sourceFilter === "independent" && task.projectId !== null) return false;
      if (sourceFilter === "project" && task.projectId === null) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = task.cleanTitle.toLowerCase().includes(q) || task.title.toLowerCase().includes(q);
        const matchDesc = task.description?.toLowerCase().includes(q);
        const matchProj = task.project?.name.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchProj) return false;
      }

      return true;
    });
  }, [tasks, statusFilter, sourceFilter, searchQuery]);

  // Derived counts
  const totalCount = tasks.length;
  const openCount = tasks.filter((t) => t.status !== "DONE").length;
  const doneCount = tasks.filter((t) => t.status === "DONE").length;
  const insightCount = tasks.filter((t) => t.sourceInsight !== null).length;

  return (
    <div className="flex-1 space-y-6 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-mono text-[var(--text-primary)] tracking-tight">
            Tasks & Actions
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
            Operational action items, insight recommendations, and project-independent tasks.
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors shadow-sm"
        >
          <Plus className="size-4" />
          <span>New Task</span>
        </button>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Total Tasks</span>
          <div className="text-xl font-bold font-mono text-[var(--text-primary)] mt-1">{totalCount}</div>
        </div>
        <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400">Open Actions</span>
          <div className="text-xl font-bold font-mono text-[var(--text-primary)] mt-1">{openCount}</div>
        </div>
        <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-green-400">Completed</span>
          <div className="text-xl font-bold font-mono text-[var(--text-primary)] mt-1">{doneCount}</div>
        </div>
        <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-violet-400">From AI Insights</span>
          <div className="text-xl font-bold font-mono text-[var(--text-primary)] mt-1">{insightCount}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        {/* Status Tabs */}
        <div className="flex items-center gap-1 bg-black/20 p-1 rounded-md border border-white/5">
          <button
            onClick={() => setStatusFilter("open")}
            className={cn(
              "px-3 py-1 text-xs font-mono font-medium rounded transition-colors",
              statusFilter === "open"
                ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            Open ({openCount})
          </button>
          <button
            onClick={() => setStatusFilter("all")}
            className={cn(
              "px-3 py-1 text-xs font-mono font-medium rounded transition-colors",
              statusFilter === "all"
                ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            All ({totalCount})
          </button>
          <button
            onClick={() => setStatusFilter("done")}
            className={cn(
              "px-3 py-1 text-xs font-mono font-medium rounded transition-colors",
              statusFilter === "done"
                ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            Completed ({doneCount})
          </button>
        </div>

        {/* Source Pills & Search */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs font-mono">
            <button
              onClick={() => setSourceFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded border text-[11px] font-mono transition-colors",
                sourceFilter === "all"
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-white/10 text-[var(--text-muted)] hover:border-white/20"
              )}
            >
              All Sources
            </button>
            <button
              onClick={() => setSourceFilter("insight")}
              className={cn(
                "px-2.5 py-1 rounded border text-[11px] font-mono transition-colors",
                sourceFilter === "insight"
                  ? "border-violet-500 text-violet-400 bg-violet-500/10"
                  : "border-white/10 text-[var(--text-muted)] hover:border-white/20"
              )}
            >
              AI Insights
            </button>
            <button
              onClick={() => setSourceFilter("independent")}
              className={cn(
                "px-2.5 py-1 rounded border text-[11px] font-mono transition-colors",
                sourceFilter === "independent"
                  ? "border-blue-500 text-blue-400 bg-blue-500/10"
                  : "border-white/10 text-[var(--text-muted)] hover:border-white/20"
              )}
            >
              Project-Independent
            </button>
          </div>

          <div className="relative min-w-[180px]">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-center text-xs font-mono text-[var(--text-muted)]">
            <Loader2 className="size-5 animate-spin mr-2" />
            Loading operational tasks...
          </div>
        ) : error ? (
          <div className="p-6 rounded-lg border border-red-500/30 bg-red-500/5 text-center text-xs font-mono text-red-400">
            {error}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <CheckCircle2 className="size-8 text-green-500/80 mb-2" />
            <p className="text-sm font-semibold font-mono text-[var(--text-primary)]">No tasks match your filter</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 max-w-sm">
              All tasks in this view are completed, or no tasks have been created under these criteria yet.
            </p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isDone = task.status === "DONE";
            const isToggling = togglingId === task.id;

            return (
              <div
                key={task.id}
                className={cn(
                  "flex items-start gap-3 p-3.5 rounded-lg border transition-colors",
                  isDone
                    ? "border-white/5 bg-white/[0.01] opacity-70"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-white/20"
                )}
              >
                {/* Toggle checkbox */}
                <button
                  type="button"
                  onClick={() => handleToggleStatus(task)}
                  disabled={isToggling}
                  aria-label={isDone ? "Mark task as incomplete" : "Mark task as completed"}
                  className="mt-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0 disabled:opacity-50"
                >
                  {isToggling ? (
                    <Loader2 className="size-4 animate-spin text-[var(--accent)]" />
                  ) : isDone ? (
                    <CheckSquare className="size-4 text-green-400" />
                  ) : (
                    <Square className="size-4" />
                  )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span
                      className={cn(
                        "text-sm font-semibold text-[var(--text-primary)] break-words",
                        isDone && "line-through text-[var(--text-muted)]"
                      )}
                    >
                      {task.cleanTitle}
                    </span>

                    {/* Priority badge */}
                    <span
                      className={cn(
                        "text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border",
                        task.priority === "HIGH"
                          ? "border-rose-500/40 text-rose-400 bg-rose-500/10"
                          : task.priority === "MEDIUM"
                          ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                          : "border-blue-500/40 text-blue-400 bg-blue-500/10"
                      )}
                    >
                      {task.priority}
                    </span>

                    {/* Source Insight Badge */}
                    {task.sourceInsight ? (
                      <Link
                        href="/ai-insights"
                        className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:border-violet-500/60 transition-colors"
                      >
                        <Sparkles className="size-3 text-violet-400" />
                        <span>Insight: {task.sourceInsight.title}</span>
                      </Link>
                    ) : null}

                    {/* Project linkage badge */}
                    {task.project ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300">
                        <FolderKanban className="size-3 text-blue-400" />
                        <span>{task.project.name}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-[var(--text-muted)] px-1.5 py-0.5 rounded border border-white/5 bg-white/[0.02]">
                        Independent Task
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  {task.description && (
                    <p className="text-xs text-[var(--text-secondary)] mt-1 whitespace-pre-wrap leading-relaxed">
                      {task.description}
                    </p>
                  )}

                  {/* Metadata footer */}
                  <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-[var(--text-muted)] mt-2.5">
                    {task.assignee && (
                      <span className="flex items-center gap-1">
                        <span className="size-4 rounded-full bg-white/10 flex items-center justify-center font-bold text-[9px]">
                          {task.assignee.avatarInitials}
                        </span>
                        <span>{task.assignee.name}</span>
                      </span>
                    )}

                    {task.dueDate && (
                      <span className="flex items-center gap-1 text-amber-400/80">
                        <Calendar className="size-3" />
                        <span>Due {new Date(task.dueDate).toLocaleDateString()}</span>
                      </span>
                    )}

                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      <span>Created {new Date(task.createdAt).toLocaleDateString()}</span>
                    </span>
                  </div>
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => handleDelete(task.id)}
                  aria-label="Delete task"
                  className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-rose-400 transition-all"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Create Task Modal */}
      {isCreateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={() => setIsCreateOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-sm font-mono font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Create New Task
              </h2>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3.5">
              <div>
                <label className="block text-xs font-mono text-[var(--text-secondary)] mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Audit API error logs"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-[var(--text-secondary)] mb-1">
                  Description / Action Details
                </label>
                <textarea
                  rows={3}
                  placeholder="Details of the action to be performed..."
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-[var(--text-secondary)] mb-1">
                    Priority
                  </label>
                  <select
                    value={createPriority}
                    onChange={(e) => setCreatePriority(e.target.value as TaskPriority)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-[var(--text-secondary)] mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={createDueDate}
                    onChange={(e) => setCreateDueDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-[var(--text-secondary)] mb-1">
                  Associated Project
                </label>
                <select
                  value={createProjectId}
                  onChange={(e) => setCreateProjectId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">No Project (Project-Independent Task)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded border border-transparent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !createTitle.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono font-bold uppercase rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
                >
                  {submitting && <Loader2 className="size-3.5 animate-spin" />}
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
