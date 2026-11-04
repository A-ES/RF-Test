"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Users,
  Building2,
  Bell,
  Shield,
  Lock,
  Plus,
  Mail,
  Check,
  Save,
  Trash2,
  ChevronDown,
  Loader2,
  AlertCircle,
  Sparkles,
  X,
  User as UserIcon,
  Briefcase,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import {
  TeamLanyardRail,
  LanyardMember,
} from "@/app/components/onboarding/team-lanyard-rail";
import { RoleSelector } from "@/app/components/ui/role-selector";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  jobTitle?: string | null;
  avatarInitials: string;
  createdAt: string;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  jobTitle?: string | null;
  status?: string;
  expiresAt: string;
  invitedBy: { name: string; email: string };
}

interface SeatInfo {
  planName: string;
  maxAdditionalSeats: number;
  activeMembers: number;
  pendingInvitations: number;
  totalUsed: number;
  availableSeats: number;
}

interface Organization {
  id: string;
  name: string;
  plan: string;
}

interface NotificationPrefs {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  emailAlerts: boolean;
  riskSignals: boolean;
  weeklyDigest: boolean;
  slackIntegration: boolean;
}

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  jobTitle?: string | null;
  avatarInitials: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

type ApiResult<T> = { data: T; error: null } | { data: null; error: string };

async function apiFetch<T>(url: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof json.error === "string" ? json.error : `Request failed (${res.status})`;
      return { data: null, error: msg };
    }
    return { data: json as T, error: null };
  } catch {
    return { data: null, error: "Network error — please try again" };
  }
}

// Generates lightweight standalone SVG initials avatar
function getInitialsAvatar(name: string, tone = 1): string {
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "RF";
  const bgColors = ["#1E222A", "#261E20", "#18242A", "#25211B", "#221E28"];
  const fgColors = ["#F24E4B", "#60A5FA", "#34D399", "#FBBF24", "#A78BFA"];
  const bg = bgColors[(tone - 1) % bgColors.length];
  const fg = fgColors[(tone - 1) % fgColors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="${bg}"/><circle cx="64" cy="64" r="56" fill="none" stroke="${fg}" stroke-width="2" opacity="0.3"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="${fg}" font-family="system-ui, -apple-system, sans-serif" font-size="44" font-weight="700" letter-spacing="1">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
      <AlertCircle className="size-3.5 shrink-0" />
      {message}
    </div>
  );
}

function InlineSuccess({ message }: { message: string }) {
  return (
    <span className="text-xs text-emerald-400 flex items-center gap-1">
      <Check className="size-3.5" />
      {message}
    </span>
  );
}

// ─── Modal: Add Team Member ──────────────────────────────────────────────────

function AddMemberModal({
  isOpen,
  onClose,
  onSuccess,
  availableSeats,
  maxAdditionalSeats,
  planName,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  availableSeats: number;
  maxAdditionalSeats: number;
  planName: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const resolvedJobTitle =
      jobTitle === "Other" ? (customRole.trim() || "Other") : jobTitle.trim();

    if (!trimmedName) {
      setError("Please provide the team member's full name.");
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Please provide a valid email address.");
      return;
    }
    if (!resolvedJobTitle) {
      setError("Please select or specify a professional role.");
      return;
    }

    setSubmitting(true);
    const result = await apiFetch<unknown>("/api/organization/invitations", {
      method: "POST",
      body: JSON.stringify({
        name: trimmedName,
        email: trimmedEmail,
        role,
        jobTitle: resolvedJobTitle,
      }),
    });
    setSubmitting(false);

    if (result.error !== null) {
      setError(result.error);
    } else {
      setName("");
      setEmail("");
      setJobTitle("");
      setCustomRole("");
      setRole("MEMBER");
      onSuccess();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[#0D0E12] p-6 shadow-2xl relative text-[var(--text-primary)]">
        <button
          onClick={onClose}
          disabled={submitting}
          className="absolute right-4 top-4 text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <div className="size-7 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)] flex items-center justify-center">
            <Plus className="size-4" />
          </div>
          <h2 className="text-base font-semibold text-white">Add Team Member</h2>
        </div>
        <p className="text-xs text-white/50 mb-5">
          Send an invitation link with assigned professional role. Seats available:{" "}
          <span className="font-mono text-emerald-400 font-bold">{availableSeats}</span> of{" "}
          <span className="font-mono text-white/80">{maxAdditionalSeats}</span> on {planName}.
        </p>

        {availableSeats <= 0 && (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-300 flex items-start gap-2.5">
            <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold">Seat Limit Reached</p>
              <p className="text-[11px] text-amber-300/80 mt-0.5">
                All {maxAdditionalSeats} additional seats on your {planName} plan are currently
                allocated. Revoke pending invitations or upgrade your tier to add more members.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4">
            <InlineError message={error} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-white/70 flex items-center gap-1.5">
              <UserIcon className="size-3.5 text-white/40" />
              Full Name
            </label>
            <input
              type="text"
              required
              disabled={submitting || availableSeats <= 0}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-white/70 flex items-center gap-1.5">
              <Mail className="size-3.5 text-white/40" />
              Email Address
            </label>
            <input
              type="email"
              required
              disabled={submitting || availableSeats <= 0}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@company.com"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-white/70 flex items-center gap-1.5">
              <Briefcase className="size-3.5 text-white/40" />
              Professional Job Title / Role (60–70 Industry Catalogue)
            </label>
            <RoleSelector
              value={jobTitle}
              customValue={customRole}
              disabled={submitting || availableSeats <= 0}
              onChange={(r, c) => {
                setJobTitle(r);
                if (c !== undefined) setCustomRole(c);
              }}
              placeholder="Search or select job role..."
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-white/70 flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-white/40" />
              Application Security Permission
            </label>
            <select
              value={role}
              disabled={submitting || availableSeats <= 0}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-white focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            >
              <option value="MEMBER">Member (Standard wholesale access)</option>
              <option value="ADMIN">Administrator (Full workspace controls & billing)</option>
            </select>
            <p className="text-[10px] text-white/40">
              Note: Professional job titles do not grant security permissions. Workspace controls
              are determined strictly by this application permission.
            </p>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-xs text-white/70 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || availableSeats <= 0}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[var(--accent)]/20"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {submitting ? "Sending Invite…" : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tab: Team Members ────────────────────────────────────────────────────────

function MembersTab({
  currentUser,
  org,
  members,
  invitations,
  seats,
  isAdmin,
  onMembersChange,
  onInvitationsChange,
}: {
  currentUser: CurrentUser;
  org: Organization | null;
  members: Member[];
  invitations: PendingInvitation[];
  seats: SeatInfo | null;
  isAdmin: boolean;
  onMembersChange: () => void;
  onInvitationsChange: () => void;
}) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<{ id: string; message: string; isError?: boolean } | null>(null);
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Seat metrics
  const maxSeats =
    seats?.maxAdditionalSeats ??
    (org?.plan === "Enterprise" || org?.id === "org_acme"
      ? 50
      : org?.plan === "RF Ultra"
      ? 10
      : 4);
  const activeAdditional = Math.max(0, members.filter((m) => m.id !== currentUser.id).length);
  const pendingCount = invitations.length;
  const totalUsed = seats?.totalUsed ?? activeAdditional + pendingCount;
  const availableSeats = seats?.availableSeats ?? Math.max(0, maxSeats - totalUsed);
  const planName = seats?.planName || org?.plan || "RF Pro";

  // Build Lanyard cards reactively from live members + pending invitations
  const lanyardItems: LanyardMember[] = useMemo(() => {
    const items: LanyardMember[] = [];
    const toneCycle: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

    // Active members
    members.forEach((member, index) => {
      const tone = toneCycle[index % toneCycle.length] ?? 1;
      const isOwnerOrAdmin = member.role === "ADMIN";
      const job =
        member.jobTitle?.trim() ||
        (isOwnerOrAdmin ? "Administrator" : "Team Member");

      items.push({
        id: member.id,
        name: member.name,
        role: job,
        team: org?.name || "RF Intelligence",
        image: getInitialsAvatar(member.name, tone),
        bio: `${member.name} · ${job} · ${isOwnerOrAdmin ? "Workspace Administrator" : "Active Member"}.`,
        tags: [isOwnerOrAdmin ? "Admin" : "Member", "Active"],
        links: [{ label: "Email", href: `mailto:${member.email}` }],
        tone,
        drop: (index * 6) % 20,
      });
    });

    // Pending invitations
    invitations.forEach((inv, index) => {
      const tone = toneCycle[(members.length + index) % toneCycle.length] ?? 2;
      const emailName = inv.email.split("@")[0].replace(/[._-]/g, " ");
      const formattedName =
        emailName.charAt(0).toUpperCase() + emailName.slice(1);
      const job =
        inv.jobTitle?.trim() ||
        (inv.role === "ADMIN" ? "Administrator (Invited)" : "Team Member (Invited)");

      items.push({
        id: `invite-${inv.id}`,
        name: formattedName,
        role: `${job} (Pending)`,
        team: `${org?.name || "RF Intelligence"} · Invited`,
        image: getInitialsAvatar(formattedName, tone),
        bio: `Invitation sent by ${inv.invitedBy?.name || "Administrator"}. Awaiting member verification.`,
        tags: ["Pending Invite", inv.role === "ADMIN" ? "Admin" : "Member"],
        links: [{ label: "Email", href: `mailto:${inv.email}` }],
        tone,
        drop: ((members.length + index) * 6) % 20,
      });
    });

    return items;
  }, [members, invitations, org?.name]);

  const handleRemove = async (id: string) => {
    setRemoveError(null);
    setRemovingId(id);
    const result = await apiFetch<unknown>(`/api/organization/members/${id}`, {
      method: "DELETE",
    });
    setRemovingId(null);
    if (result.error !== null) {
      setRemoveError(result.error);
    } else {
      onMembersChange();
      onInvitationsChange();
    }
  };

  const handleRevokeInvitation = async (id: string) => {
    setRevokeError(null);
    setResendStatus(null);
    setRevokingId(id);
    const result = await apiFetch<unknown>(`/api/organization/invitations?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setRevokingId(null);
    if (result.error !== null) {
      setRevokeError(result.error);
    } else {
      onInvitationsChange();
    }
  };

  const handleResendInvitation = async (id: string) => {
    setRevokeError(null);
    setResendingId(id);
    setResendStatus(null);
    const result = await apiFetch<{
      ok?: boolean;
      error?: string;
      emailDelivery?: { delivered: boolean; error?: string };
    }>("/api/organization/invitations/resend", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    setResendingId(null);
    if (result.error !== null) {
      setResendStatus({ id, message: result.error, isError: true });
    } else if (result.data?.emailDelivery?.delivered === false) {
      setResendStatus({
        id,
        message: result.data.emailDelivery.error || "Delivery failed (check SMTP settings)",
        isError: true,
      });
    } else {
      setResendStatus({ id, message: "Invitation email resent successfully!" });
      onInvitationsChange();
    }
  };

  const handleRoleChange = async (id: string, newRole: "ADMIN" | "MEMBER") => {
    setRoleError(null);
    setRoleChangingId(id);
    const result = await apiFetch<unknown>(`/api/organization/members/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: newRole }),
    });
    setRoleChangingId(null);
    if (result.error !== null) {
      setRoleError(result.error);
    } else {
      onMembersChange();
    }
  };

  return (
    <div className="space-y-6">
      {/* ─── Seat Allocation & Capacity Banner ─── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-[var(--text-primary)]">
                {planName} Team Capacity
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Active Subscription
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Plan allocation: 1 Workspace Owner + up to {maxSeats} additional team members.
            </p>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            <div className="text-left sm:text-right">
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block">
                Team Members
              </span>
              <span className="text-sm font-bold text-[var(--text-primary)] font-mono">
                {totalUsed} / {maxSeats}
              </span>
            </div>

            <div className="text-left sm:text-right">
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block">
                Available Seats
              </span>
              <span
                className={`text-sm font-bold font-mono ${
                  availableSeats === 0 ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {availableSeats}
              </span>
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                disabled={availableSeats <= 0}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[var(--accent)]/20"
              >
                <Plus className="size-4" />
                <span>Add Team Member</span>
              </button>
            )}
          </div>
        </div>

        {/* Capacity Progress Bar */}
        <div className="pt-2 border-t border-[var(--border)]">
          <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)] mb-1.5">
            <span>Seat Utilization ({totalUsed} consumed: {activeAdditional} active + {pendingCount} pending)</span>
            <span>{Math.min(100, Math.round((totalUsed / Math.max(1, maxSeats)) * 100))}%</span>
          </div>
          <div className="h-1.5 w-full bg-[var(--surface-elevated)] rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                availableSeats === 0 ? "bg-amber-400" : "bg-[var(--accent)]"
              }`}
              style={{
                width: `${Math.min(100, Math.max(4, Math.round((totalUsed / Math.max(1, maxSeats)) * 100)))}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* ─── Persistent ID Cards Rail (TeamLanyardRail) ─── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[#0A0B0E] p-4 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--accent)]">
              <Sparkles className="size-3" />
              <span>PERSISTENT CREDENTIALS DIRECTORY</span>
            </div>
            <h2 className="text-base font-semibold text-white tracking-tight">
              Interactive Team Security Cards
            </h2>
          </div>
          <span className="text-xs font-mono text-white/50 bg-white/5 px-2.5 py-1 rounded-md border border-white/10 self-start sm:self-auto">
            {lanyardItems.length} {lanyardItems.length === 1 ? "Credential" : "Credentials"} On Record
          </span>
        </div>
        <p className="text-xs text-white/60 mb-4 max-w-2xl">
          Live workspace credentials for {org?.name || "your organization"}. Click or tap any badge to flip between identification and digital role credentials.
        </p>

        <TeamLanyardRail
          items={lanyardItems}
          eyebrow="SECURITY BADGES"
          heading={`${org?.name || "Workspace"} Team`}
          caption="Tug or click badges to inspect contact links and security authorization."
          autoplay={false}
        />
      </div>

      {/* ─── Pending Invitations Table ─── */}
      {isAdmin && invitations.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-elevated)]/40 flex items-center justify-between">
            <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
              Pending Invitations ({invitations.length})
            </span>
            <span className="text-[10px] font-mono text-amber-400">
              Consumes {invitations.length} seat{invitations.length === 1 ? "" : "s"}
            </span>
          </div>

          {revokeError && (
            <div className="p-3 border-b border-[var(--border)]">
              <InlineError message={revokeError} />
            </div>
          )}

          {resendStatus && (
            <div
              className={`p-3 text-xs border-b ${
                resendStatus.isError
                  ? "bg-rose-500/10 border-rose-500/20 text-rose-300"
                  : "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
              } flex items-center justify-between`}
            >
              <span>{resendStatus.message}</span>
              <button
                onClick={() => setResendStatus(null)}
                className="text-white/60 hover:text-white text-[11px]"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="divide-y divide-[var(--border)]">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="p-4 grid grid-cols-1 sm:grid-cols-[1.5fr_1.2fr_1fr_150px] gap-3 items-center text-xs hover:bg-[var(--surface-elevated)]/40 transition-colors"
              >
                <div>
                  <p className="font-medium text-[var(--text-primary)]">{inv.email}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Invited by {inv.invitedBy?.name || "Administrator"}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-white/90">
                    {inv.jobTitle || "Team Member"}
                  </span>
                  <span className="text-[10px] text-white/40 block">Professional Role</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-xs px-2 py-0.5 text-[10px] font-mono uppercase bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--text-primary)]">
                    {inv.role}
                  </span>
                  <span className="rounded-full px-2.5 py-0.5 text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Pending
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => handleResendInvitation(inv.id)}
                    disabled={resendingId === inv.id}
                    className="text-sky-400 hover:text-sky-300 px-2 py-1 rounded text-xs transition-colors disabled:opacity-40 flex items-center gap-1"
                    title="Resend invitation email"
                  >
                    {resendingId === inv.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Mail className="size-3" />
                    )}
                    Resend
                  </button>
                  <button
                    onClick={() => handleRevokeInvitation(inv.id)}
                    disabled={revokingId === inv.id}
                    className="text-rose-400 hover:text-rose-300 px-2 py-1 rounded text-xs transition-colors disabled:opacity-40"
                    title="Revoke invitation & free seat"
                  >
                    {revokingId === inv.id ? (
                      <Loader2 className="size-3.5 animate-spin inline mr-1" />
                    ) : null}
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Members Directory Table ─── */}
      {removeError && <InlineError message={removeError} />}
      {roleError && <InlineError message={roleError} />}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-elevated)]/40 font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-wider grid grid-cols-1 sm:grid-cols-[1.5fr_1.2fr_100px_80px_80px] gap-2 items-center">
          <span>User</span>
          <span>Professional Role</span>
          <span>Access Level</span>
          <span>Status</span>
          <span className="text-right">Action</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {members.map((member) => {
            const isSelf = member.id === currentUser.id;
            const isChangingRole = roleChangingId === member.id;
            const isRemoving = removingId === member.id;

            return (
              <div
                key={member.id}
                className="p-4 grid grid-cols-1 sm:grid-cols-[1.5fr_1.2fr_100px_80px_80px] gap-2 items-center text-xs hover:bg-[var(--surface-elevated)]/40 transition-colors"
              >
                {/* User info */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-8 rounded-full bg-[var(--surface-elevated)] border border-[var(--border)] flex items-center justify-center font-mono font-semibold text-xs text-[var(--text-primary)] shrink-0">
                    {member.avatarInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--text-primary)] truncate">
                      {member.name}
                      {isSelf && (
                        <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">(you)</span>
                      )}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {member.email}
                    </p>
                  </div>
                </div>

                {/* Professional Role */}
                <div className="min-w-0">
                  <p className="font-medium text-white/90 truncate">
                    {member.jobTitle || (member.role === "ADMIN" ? "Administrator" : "Team Member")}
                  </p>
                  <span className="text-[10px] text-white/40 block font-mono">Job Title</span>
                </div>

                {/* Permission selector — Admin only, not for self */}
                <div>
                  {isAdmin && !isSelf ? (
                    <div className="relative inline-flex items-center">
                      <select
                        value={member.role}
                        disabled={isChangingRole}
                        onChange={(e) =>
                          handleRoleChange(member.id, e.target.value as "ADMIN" | "MEMBER")
                        }
                        className="appearance-none rounded-xs pl-2 pr-6 py-0.5 text-[10px] font-mono uppercase bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none disabled:opacity-60 cursor-pointer"
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="MEMBER">Member</option>
                      </select>
                      {isChangingRole ? (
                        <Loader2 className="absolute right-1 size-3 animate-spin text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown className="absolute right-1 size-3 text-[var(--text-muted)] pointer-events-none" />
                      )}
                    </div>
                  ) : (
                    <span className="rounded-xs px-2 py-0.5 text-[10px] font-mono uppercase bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--text-primary)]">
                      {member.role}
                    </span>
                  )}
                </div>

                {/* Status */}
                <div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Active
                  </span>
                </div>

                {/* Remove button — Admin only, not for self */}
                <div className="text-right">
                  {isAdmin && !isSelf && (
                    <button
                      onClick={() => handleRemove(member.id)}
                      disabled={isRemoving}
                      className="text-[var(--text-muted)] hover:text-rose-400 p-1 transition-colors disabled:opacity-40"
                      title="Remove member"
                    >
                      {isRemoving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Member Modal */}
      <AddMemberModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => {
          onMembersChange();
          onInvitationsChange();
        }}
        availableSeats={availableSeats}
        maxAdditionalSeats={maxSeats}
        planName={planName}
      />
    </div>
  );
}

// ─── Tab: Company Profile ─────────────────────────────────────────────────────

function OrganizationTab({
  org,
  onOrgChange,
}: {
  org: Organization;
  onOrgChange: (updated: Organization) => void;
}) {
  const [name, setName] = useState(org.name);
  const [plan, setPlan] = useState(org.plan);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(org.name);
    setPlan(org.plan);
  }, [org.name, org.plan]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);

    const result = await apiFetch<{ organization: Organization }>("/api/organization", {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim(), plan }),
    });

    setSaving(false);
    if (result.error !== null) {
      setError(result.error);
    } else {
      onOrgChange(result.data.organization);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <form
        onSubmit={handleSave}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4"
      >
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Organization Profile
        </h2>

        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)] font-medium">
            Organization Name
          </label>
          <input
            type="text"
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)] font-medium">
            Subscription Tier
          </label>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none"
          >
            <option value="Enterprise">Enterprise ($2,400 / mo)</option>
            <option value="Pro">Pro ($800 / mo)</option>
            <option value="Starter">Starter ($200 / mo)</option>
          </select>
        </div>

        {error && <InlineError message={error} />}

        <div className="pt-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {saved && <InlineSuccess message="Saved!" />}
        </div>
      </form>
    </div>
  );
}

// ─── Tab: Notification Preferences ───────────────────────────────────────────

function NotificationsTab({ prefs }: { prefs: NotificationPrefs }) {
  const [local, setLocal] = useState<NotificationPrefs>(prefs);
  const [saving, setSaving] = useState<string | null>(null);

  const handleToggle = async (field: keyof NotificationPrefs, value: boolean) => {
    const updated = { ...local, [field]: value };
    setLocal(updated);
    setSaving(field);

    await apiFetch("/api/notification-preferences", {
      method: "PATCH",
      body: JSON.stringify(updated),
    });
    setSaving(null);
  };

  const toggleRow = (
    field: keyof NotificationPrefs,
    label: string,
    description: string,
  ) => (
    <div key={field} className="flex items-center justify-between py-3">
      <div>
        <p className="text-xs font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-[11px] text-[var(--text-muted)]">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {saving === field && (
          <Loader2 className="size-3 animate-spin text-[var(--text-muted)]" />
        )}
        <input
          type="checkbox"
          checked={local[field]}
          disabled={saving === field}
          onChange={(e) => handleToggle(field, e.target.checked)}
          className="size-4 accent-[var(--accent)] disabled:opacity-60"
        />
      </div>
    </div>
  );

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Notification Preferences
        </h2>
        <div className="space-y-4 divide-y divide-[var(--border)]">
          {toggleRow(
            "riskSignals",
            "Critical Risk Signals",
            "Instant alerts when account sentiment drops drastically.",
          )}
          {toggleRow(
            "emailAlerts",
            "Email Summary Briefs",
            "Daily morning briefing with top insights.",
          )}
          {toggleRow(
            "weeklyDigest",
            "Weekly Digest",
            "Weekly summary of activity and insights.",
          )}
          {toggleRow(
            "slackIntegration",
            "Slack Integration Webhook",
            "Stream notifications into #rf-intelligence Slack channel.",
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Security & Access ───────────────────────────────────────────────────

function SecurityTab() {
  const [mfaEnabled, setMfaEnabled] = useState(true);
  const [ssoEnforced, setSsoEnforced] = useState(true);

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Lock className="size-4 text-emerald-400" />
          Security & Compliance Policies
        </h2>
        <div className="space-y-4 divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Enforce Multi-Factor Auth (MFA)
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Require authenticator apps for all team members.
              </p>
            </div>
            <input
              type="checkbox"
              checked={mfaEnabled}
              onChange={(e) => setMfaEnabled(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
          </div>
          <div className="flex items-center justify-between pt-3">
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Single Sign-On (SAML/Okta SSO)
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Restrict login to corporate identity provider.
              </p>
            </div>
            <input
              type="checkbox"
              checked={ssoEnforced}
              onChange={(e) => setSsoEnforced(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Team Page ───────────────────────────────────────────────────────────

type Tab = "members" | "organization" | "notifications" | "security";

export default function TeamPage() {
  const [activeTab, setActiveTab] = useState<Tab>("members");

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [seats, setSeats] = useState<SeatInfo | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    const result = await apiFetch<{ members: Member[] }>("/api/organization/members");
    if (result.error === null) setMembers(result.data.members);
  }, []);

  const loadInvitations = useCallback(async () => {
    const result = await apiFetch<{ invitations: PendingInvitation[]; seats?: SeatInfo }>(
      "/api/organization/invitations",
    );
    if (result.error === null) {
      setInvitations(result.data.invitations);
      if (result.data.seats) setSeats(result.data.seats);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [userRes, orgRes, membersRes, prefsRes] = await Promise.all([
        apiFetch<{ user: CurrentUser }>("/api/users/me"),
        apiFetch<{ organization: Organization }>("/api/organization"),
        apiFetch<{ members: Member[] }>("/api/organization/members"),
        apiFetch<{ preferences: NotificationPrefs }>("/api/notification-preferences"),
      ]);

      if (cancelled) return;

      if (userRes.error !== null || orgRes.error !== null || membersRes.error !== null) {
        setBootstrapError(
          userRes.error ?? orgRes.error ?? membersRes.error ?? "Failed to load page data",
        );
        setLoading(false);
        return;
      }

      setCurrentUser(userRes.data.user);
      setOrg(orgRes.data.organization);
      setMembers(membersRes.data.members);
      if (prefsRes.error === null) setPrefs(prefsRes.data.preferences);

      if (userRes.data.user.role === "ADMIN") {
        const invRes = await apiFetch<{ invitations: PendingInvitation[]; seats?: SeatInfo }>(
          "/api/organization/invitations",
        );
        if (!cancelled && invRes.error === null) {
          setInvitations(invRes.data.invitations);
          if (invRes.data.seats) setSeats(invRes.data.seats);
        }
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-6">
        <div>
          <p className="dash-eyebrow">/ team & organization</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
            Account Settings & Workspace Controls
          </h1>
        </div>
        <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
          <Loader2 className="size-6 animate-spin mr-2" />
          <span className="text-sm">Loading team settings…</span>
        </div>
      </div>
    );
  }

  if (bootstrapError || !currentUser || !org) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-6">
        <div>
          <p className="dash-eyebrow">/ team & organization</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
            Account Settings & Workspace Controls
          </h1>
        </div>
        <InlineError message={bootstrapError ?? "Failed to load page data"} />
      </div>
    );
  }

  const isAdmin = currentUser.role === "ADMIN";

  const defaultPrefs: NotificationPrefs = {
    emailEnabled: true,
    inAppEnabled: true,
    emailAlerts: true,
    riskSignals: true,
    weeklyDigest: true,
    slackIntegration: false,
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: "members",
      label: "Team Members",
      icon: <Users className="size-4" />,
      badge: String(members.length),
    },
    {
      id: "organization",
      label: "Company Profile",
      icon: <Building2 className="size-4" />,
    },
    {
      id: "notifications",
      label: "Notification Toggles",
      icon: <Bell className="size-4" />,
    },
    {
      id: "security",
      label: "Security & Access",
      icon: <Shield className="size-4" />,
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      {/* Header */}
      <div>
        <p className="dash-eyebrow">/ team & organization</p>
        <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
          Account Settings & Workspace Controls
        </h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Manage workspace profile, invite team members with industry-standard roles, view persistent security credentials, and configure permissions.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-[var(--border)] gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && (
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                ({tab.badge})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "members" && (
        <MembersTab
          currentUser={currentUser}
          org={org}
          members={members}
          invitations={invitations}
          seats={seats}
          isAdmin={isAdmin}
          onMembersChange={loadMembers}
          onInvitationsChange={loadInvitations}
        />
      )}

      {activeTab === "organization" && isAdmin && (
        <OrganizationTab org={org} onOrgChange={setOrg} />
      )}
      {activeTab === "organization" && !isAdmin && (
        <div className="max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Organization Profile
            </h2>
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--text-muted)] font-medium">Organization Name</p>
              <p className="text-xs text-[var(--text-primary)]">{org.name}</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--text-muted)] font-medium">Subscription Tier</p>
              <p className="text-xs text-[var(--text-primary)]">{org.plan}</p>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Only Admins can edit the organization profile.
            </p>
          </div>
        </div>
      )}

      {activeTab === "notifications" && (
        <NotificationsTab prefs={prefs ?? defaultPrefs} />
      )}

      {activeTab === "security" && <SecurityTab />}
    </div>
  );
}
