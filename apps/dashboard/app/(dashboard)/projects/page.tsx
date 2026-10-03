"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  FolderKanban,
  Plus,
  Search,
  Filter,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
  ListTodo,
} from "lucide-react";
import { ActiveProjectsList, type OrgMember } from "@/app/components/dashboard/active-projects-list";
import { type Project, type ProjectStatus, getInitials } from "@/app/types/project";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  title: string;
  assigneeId: string;
  dueDate: string;
}

interface FormValues {
  name: string;
  accountName: string;
  ownerId: string;
  status: ProjectStatus;
  dueDate: string; // "YYYY-MM-DD" from <input type="date">
}

interface Toast {
  id: number;
  type: "error" | "success";
  message: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIso(dateStr: string): string {
  return new Date(dateStr + "T00:00:00.000Z").toISOString();
}

function toLocalDateString(isoStr: string): string {
  if (!isoStr) return "";
  try {
    return new Date(isoStr).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

const EMPTY_FORM: FormValues = {
  name: "",
  accountName: "",
  ownerId: "",
  status: "ON_TRACK",
  dueDate: "",
};

// ─── Toast component ──────────────────────────────────────────────────────────

function ToastBanner({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 6000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-xs shadow-lg max-w-sm animate-in slide-in-from-bottom-2 duration-200 ${
        toast.type === "error"
          ? "border-[var(--dash-status-error)]/30 bg-[var(--surface-elevated)] text-[var(--dash-status-error)]"
          : "border-[var(--dash-status-running)]/30 bg-[var(--surface-elevated)] text-[var(--dash-status-running)]"
      }`}
    >
      {toast.type === "error" ? (
        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
      ) : (
        <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
      )}
      <span className="flex-1 text-[var(--text-primary)]">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const [projects, setProjects]         = useState<Project[]>([]);
  const [members, setMembers]           = useState<OrgMember[]>([]);
  const [loading, setLoading]           = useState(true);
  const [searchQuery, setSearchQuery]   = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modal State
  const [dialogOpen, setDialogOpen]             = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [form, setForm]                         = useState<FormValues>(EMPTY_FORM);
  const [formTasks, setFormTasks]               = useState<TaskRow[]>([]);
  const [formErrors, setFormErrors]             = useState<Partial<Record<keyof FormValues, string>>>({});
  const [submitting, setSubmitting]             = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter        = useRef(0);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projects: Project[] };
      setProjects(
        data.projects.map((p) => ({ ...p, ownerInitials: getInitials(p.ownerName) }))
      );
    } catch {
      pushToast("error", "Failed to load projects. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (!res.ok) return;
      const data = (await res.json()) as { members: OrgMember[] };
      setMembers(data.members);
    } catch {
      // non-fatal — owner dropdown will be empty but form still works
    }
  }, []);

  useEffect(() => {
    void loadProjects();
    void loadMembers();
  }, [loadProjects, loadMembers]);

  // ── Toast helpers ─────────────────────────────────────────────────────────

  const pushToast = (type: Toast["type"], message: string) => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, type, message }]);
  };

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Form helpers ──────────────────────────────────────────────────────────

  const handleFieldChange = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key]) {
      setFormErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  // Task rows helpers for form
  const handleAddTaskRow = () => {
    setFormTasks((prev) => [
      ...prev,
      { id: `task_row_${Date.now()}_${Math.random()}`, title: "", assigneeId: "", dueDate: "" },
    ]);
  };

  const handleRemoveTaskRow = (id: string) => {
    setFormTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleUpdateTaskRow = (id: string, field: keyof TaskRow, value: string) => {
    setFormTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const validate = (): boolean => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!form.name.trim())        errors.name        = "Project name is required";
    if (!form.accountName.trim()) errors.accountName = "Client / account is required";
    if (!form.ownerId)            errors.ownerId     = "Owner is required";
    if (!form.dueDate)            errors.dueDate     = "Target date is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setForm(EMPTY_FORM);
      setFormTasks([]);
      setFormErrors({});
      setEditingProjectId(null);
    }
  };

  const handleOpenEditModal = (project: Project) => {
    setEditingProjectId(project.id);
    setForm({
      name: project.name,
      accountName: project.accountName,
      ownerId: project.ownerId,
      status: project.status,
      dueDate: toLocalDateString(project.dueDate),
    });
    setFormTasks([]);
    setFormErrors({});
    setDialogOpen(true);
  };

  const handleProjectUpdated = (updatedProject: Project) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === updatedProject.id
          ? { ...updatedProject, ownerInitials: getInitials(updatedProject.ownerName) }
          : p
      )
    );
  };

  // ── Create or Edit submit handler ─────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);

    const selectedMember = members.find((m) => m.id === form.ownerId);
    const ownerName      = selectedMember?.name ?? "Unknown";

    if (editingProjectId) {
      // ── EDIT EXISTING PROJECT ──
      try {
        const res = await fetch(`/api/projects/${editingProjectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            accountName: form.accountName.trim(),
            ownerId: form.ownerId,
            status: form.status,
            dueDate: toIso(form.dueDate),
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as { project: Project };
        const updated = { ...data.project, ownerInitials: getInitials(data.project.ownerName) };

        handleProjectUpdated(updated);
        pushToast("success", "Project updated successfully.");
        setDialogOpen(false);
        setForm(EMPTY_FORM);
        setEditingProjectId(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update project";
        pushToast("error", `Update failed — ${message}.`);
      } finally {
        setSubmitting(false);
      }
    } else {
      // ── CREATE NEW PROJECT ──
      const tempId = `optimistic_${Date.now()}`;
      const validSubtasks = formTasks
        .filter((t) => t.title.trim())
        .map((t) => ({
          title: t.title.trim(),
          assigneeId: t.assigneeId || undefined,
          dueDate: t.dueDate ? toIso(t.dueDate) : undefined,
        }));

      const optimisticProject: Project = {
        id: tempId,
        name: form.name.trim(),
        accountName: form.accountName.trim(),
        status: form.status,
        progress: 0,
        dueDate: toIso(form.dueDate),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        openTasksCount: validSubtasks.length,
        ownerId: form.ownerId,
        ownerName,
        ownerInitials: getInitials(ownerName),
        tasks: validSubtasks.map((st, idx) => ({
          id: `opt_st_${idx}`,
          title: st.title,
          status: "TODO",
          dueDate: st.dueDate ?? null,
          assigneeId: st.assigneeId ?? null,
          assigneeName: members.find((m) => m.id === st.assigneeId)?.name ?? null,
        })),
        activities: [],
        documents: [],
        reports: [],
        insights: [],
      };

      setProjects((prev) => [optimisticProject, ...prev]);
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setFormTasks([]);
      setFormErrors({});

      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            accountName: form.accountName.trim(),
            ownerId: form.ownerId,
            status: form.status,
            dueDate: toIso(form.dueDate),
            tasks: validSubtasks,
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as { project: Project };
        const saved = { ...data.project, ownerInitials: getInitials(data.project.ownerName) };

        setProjects((prev) => prev.map((p) => (p.id === tempId ? saved : p)));
        window.dispatchEvent(new CustomEvent("rf:project-created", { detail: saved }));
        pushToast("success", "New project created successfully.");
      } catch (err) {
        setProjects((prev) => prev.filter((p) => p.id !== tempId));
        const message = err instanceof Error ? err.message : "Failed to create project";
        pushToast("error", `Project not saved — ${message}. Please try again.`);
      } finally {
        setSubmitting(false);
      }
    }
  };

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filteredProjects = projects.filter((proj) => {
    if (statusFilter !== "all" && proj.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        proj.name.toLowerCase().includes(q) ||
        proj.accountName.toLowerCase().includes(q) ||
        proj.ownerName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="mx-auto max-w-[1200px] space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="dash-eyebrow">/ projects</p>
            <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
              Active Engagements &amp; Milestones
            </h1>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Track milestones, owners, and delivery status across all active engagements.
            </p>
          </div>

          <Dialog.Root open={dialogOpen} onOpenChange={handleOpenChange}>
            <Dialog.Trigger asChild>
              <button className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors shadow-sm">
                <Plus className="size-4" aria-hidden />
                New Project
              </button>
            </Dialog.Trigger>

            {/* ── Modal ── */}
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150" />
              <Dialog.Content
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-elevated)] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 focus:outline-none max-h-[90vh] overflow-y-auto"
                aria-describedby="project-modal-desc"
              >
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <Dialog.Title className="text-sm font-semibold text-[var(--text-primary)]">
                      {editingProjectId ? "Edit Project" : "New Project"}
                    </Dialog.Title>
                    <Dialog.Description id="project-modal-desc" className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {editingProjectId
                        ? "Update project details below."
                        : "Fill in the details and optional subtasks below."}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      aria-label="Close dialog"
                      className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors"
                    >
                      <X className="size-4" />
                    </button>
                  </Dialog.Close>
                </div>

                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  {/* Project name */}
                  <Field label="Project name" error={formErrors.name} required>
                    <input
                      type="text"
                      id="field-name"
                      value={form.name}
                      onChange={(e) => handleFieldChange("name", e.target.value)}
                      placeholder="e.g. Q4 Enterprise Security Audit"
                      maxLength={200}
                      autoFocus
                      className={inputClass(!!formErrors.name)}
                    />
                  </Field>

                  {/* Client / account */}
                  <Field label="Client / account" error={formErrors.accountName} required>
                    <input
                      type="text"
                      id="field-accountName"
                      value={form.accountName}
                      onChange={(e) => handleFieldChange("accountName", e.target.value)}
                      placeholder="e.g. Acme Corp"
                      maxLength={200}
                      className={inputClass(!!formErrors.accountName)}
                    />
                  </Field>

                  {/* Owner */}
                  <Field label="Owner" error={formErrors.ownerId} required>
                    <select
                      id="field-ownerId"
                      value={form.ownerId}
                      onChange={(e) => handleFieldChange("ownerId", e.target.value)}
                      className={selectClass(!!formErrors.ownerId)}
                    >
                      <option value="">Select a team member…</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {/* Status */}
                  <Field label="Status" error={formErrors.status} required>
                    <select
                      id="field-status"
                      value={form.status}
                      onChange={(e) => handleFieldChange("status", e.target.value as ProjectStatus)}
                      className={selectClass(!!formErrors.status)}
                    >
                      <option value="ON_TRACK">On track</option>
                      <option value="AT_RISK">At risk</option>
                      <option value="BLOCKED">Blocked</option>
                      <option value="COMPLETED">Completed</option>
                    </select>
                  </Field>

                  {/* Target date */}
                  <Field label="Target date" error={formErrors.dueDate} required>
                    <input
                      type="date"
                      id="field-dueDate"
                      value={form.dueDate}
                      onChange={(e) => handleFieldChange("dueDate", e.target.value)}
                      className={inputClass(!!formErrors.dueDate)}
                    />
                  </Field>

                  {/* Repeatable Subtasks Section (Only shown when creating new project) */}
                  {!editingProjectId && (
                    <div className="pt-2 border-t border-[var(--border)] space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                          <ListTodo className="size-3.5 text-[var(--accent)]" />
                          Initial Subtasks (Optional)
                        </label>
                        <button
                          type="button"
                          onClick={handleAddTaskRow}
                          className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium transition-colors"
                        >
                          <Plus className="size-3.5" />
                          Add task
                        </button>
                      </div>

                      {formTasks.length > 0 ? (
                        <div className="space-y-2">
                          {formTasks.map((tRow, index) => (
                            <div
                              key={tRow.id}
                              className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-2 relative"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                                  Task #{index + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTaskRow(tRow.id)}
                                  className="text-[var(--text-muted)] hover:text-[var(--dash-status-error)] transition-colors p-0.5"
                                  title="Remove task row"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>

                              <input
                                type="text"
                                value={tRow.title}
                                onChange={(e) => handleUpdateTaskRow(tRow.id, "title", e.target.value)}
                                placeholder="Subtask title (e.g. Draft SOW)"
                                maxLength={200}
                                className={inputClass(false)}
                              />

                              <div className="grid grid-cols-2 gap-2">
                                <select
                                  value={tRow.assigneeId}
                                  onChange={(e) => handleUpdateTaskRow(tRow.id, "assigneeId", e.target.value)}
                                  className={selectClass(false)}
                                >
                                  <option value="">Optional Assignee</option>
                                  {members.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}
                                    </option>
                                  ))}
                                </select>

                                <input
                                  type="date"
                                  value={tRow.dueDate}
                                  onChange={(e) => handleUpdateTaskRow(tRow.id, "dueDate", e.target.value)}
                                  className={inputClass(false)}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)] italic">
                          No initial subtasks added yet. You can also add subtasks anytime after creation.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-3.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-colors"
                      >
                        Cancel
                      </button>
                    </Dialog.Close>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submitting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                      {editingProjectId ? "Save Changes" : "Create Project"}
                    </button>
                  </div>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>

        {/* Filter Row */}
        <div className="flex items-center gap-3 flex-wrap border-b border-[var(--border)] pb-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-[var(--text-muted)]" aria-hidden />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects by name, account, or owner…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Filter className="size-3.5" aria-hidden />
            <span>Status:</span>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="ON_TRACK">On Track</option>
            <option value="AT_RISK">At Risk</option>
            <option value="BLOCKED">Blocked</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </div>

        {/* Projects List */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-xs text-[var(--text-muted)] gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading projects…
          </div>
        ) : (
          <ActiveProjectsList
            projects={filteredProjects}
            members={members}
            standalone
            onEditProject={handleOpenEditModal}
            onProjectUpdated={handleProjectUpdated}
          />
        )}
      </div>

      {/* Toast stack (bottom-right) */}
      <div
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastBanner toast={t} onDismiss={dismissToast} />
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Small form helpers ───────────────────────────────────────────────────────

function inputClass(hasError: boolean) {
  return `w-full rounded-lg border bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none transition-colors ${
    hasError
      ? "border-[var(--dash-status-error)] focus:border-[var(--dash-status-error)]"
      : "border-[var(--border)] focus:border-[var(--accent)]"
  }`;
}

function selectClass(hasError: boolean) {
  return `w-full rounded-lg border bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none transition-colors ${
    hasError
      ? "border-[var(--dash-status-error)] focus:border-[var(--dash-status-error)]"
      : "border-[var(--border)] focus:border-[var(--accent)]"
  }`;
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-[var(--text-secondary)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--dash-status-error)]" aria-hidden>*</span>}
      </label>
      {children}
      {error && (
        <p className="text-[11px] text-[var(--dash-status-error)] flex items-center gap-1">
          <AlertCircle className="size-3" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
