"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Plus,
  Trash2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Mail,
  User,
  AlertCircle,
  SkipForward,
  ShieldCheck,
  Briefcase,
} from "lucide-react";
import { RoleSelector } from "@/app/components/ui/role-selector";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  customRole?: string;
}

export default function TeamSetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [planName, setPlanName] = useState("RF Pro");
  const [maxAdditionalSeats, setMaxAdditionalSeats] = useState(4);
  const [ownerName, setOwnerName] = useState("Organization Owner");
  const [ownerEmail, setOwnerEmail] = useState("");

  const [members, setMembers] = useState<MemberRow[]>([]);

  useEffect(() => {
    async function loadTeamData() {
      try {
        const res = await fetch("/api/onboarding/status");
        if (res.ok) {
          const data = await res.json();
          const planSlug = data.status?.subscriptionPlan || "rf-pro";
          const isUltra = planSlug === "rf-ultra";
          setPlanName(isUltra ? "RF Ultra" : "RF Pro");
          setMaxAdditionalSeats(isUltra ? 10 : 4);

          if (data.owner) {
            setOwnerName(data.owner.name);
            setOwnerEmail(data.owner.email);
          } else if (data.session) {
            setOwnerName(data.session.name);
            setOwnerEmail(data.session.email);
          }

          if (data.status?.invitedMembers?.length > 0) {
            setMembers(
              data.status.invitedMembers.map((m: any, i: number) => ({
                id: `saved_${i}`,
                name: m.name,
                email: m.email,
                role: m.role || "Operations Manager",
                customRole: "",
              }))
            );
          } else {
            // Pre-seed 1 empty row for immediate editing
            setMembers([
              {
                id: "row_1",
                name: "",
                email: "",
                role: "Operations Manager",
                customRole: "",
              },
            ]);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadTeamData();
  }, []);

  const remainingSeats = Math.max(0, maxAdditionalSeats - members.length);

  function addRow() {
    if (members.length >= maxAdditionalSeats) return;
    setMembers([
      ...members,
      {
        id: `row_${Date.now()}`,
        name: "",
        email: "",
        role: "Software Engineer",
        customRole: "",
      },
    ]);
  }

  function removeRow(id: string) {
    setMembers(members.filter((m) => m.id !== id));
  }

  function updateRow(id: string, field: keyof MemberRow, value: string) {
    setMembers(
      members.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  }

  async function handleSaveTeam(skip = false) {
    setError(null);
    setSaving(true);

    try {
      // Filter out completely blank rows
      const populatedMembers = members
        .map((m) => {
          const resolvedRole =
            m.role === "Other"
              ? (m.customRole?.trim() || "Other")
              : m.role.trim();
          return {
            name: m.name.trim(),
            email: m.email.trim().toLowerCase(),
            role: resolvedRole,
          };
        })
        .filter((m) => m.name || m.email);

      if (!skip && populatedMembers.length > 0) {
        for (const m of populatedMembers) {
          if (!m.name) {
            setError(`Please provide a name for ${m.email}`);
            setSaving(false);
            return;
          }
          if (!m.email || !m.email.includes("@")) {
            setError(`Invalid email address: "${m.email}"`);
            setSaving(false);
            return;
          }
          if (!m.role) {
            setError(`Please select a professional role for ${m.name}`);
            setSaving(false);
            return;
          }
        }
      }

      const res = await fetch("/api/onboarding/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: skip ? [] : populatedMembers,
          skip,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send team invitations.");
        return;
      }

      // Proceed to Step 6: Team Presentation
      router.push("/onboarding/presentation");
    } catch {
      setError("Network error while inviting team.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="size-8 rounded-full border-2 border-[#F24E4B] border-t-transparent animate-spin mb-4" />
        <p className="text-sm text-white/60 font-mono">Loading team seat limits...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F24E4B]/10 border border-[#F24E4B]/30 text-[#F24E4B] text-xs font-mono font-medium">
          <Users className="size-3.5" />
          <span>STEP 5 OF 6 &bull; TEAM ONBOARDING</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
          Invite your operational team
        </h1>
        <p className="text-xs sm:text-sm text-white/60 max-w-xl mx-auto">
          Add colleagues who need workspace access. Assign each member a professional role from the 60–70 industry role catalogue. You can also invite additional members later in Teams.
        </p>
      </div>

      {/* Seat Capacity Card */}
      <div className="rounded-xl border border-white/10 bg-[#0D0E12] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-[#F24E4B]/10 border border-[#F24E4B]/30 text-[#F24E4B] flex items-center justify-center font-bold">
            <Users className="size-5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white">
              {planName} Seat Capacity
            </div>
            <div className="text-[11px] text-white/50">
              1 Owner + up to {maxAdditionalSeats} additional team members
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-right">
            <span className="text-white/40 block text-[10px]">REMAINING SEATS</span>
            <span
              className={`font-bold text-sm ${
                remainingSeats === 0 ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {remainingSeats} of {maxAdditionalSeats} available
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[#F24E4B]/40 bg-[#F24E4B]/10 p-3 text-xs text-[#F24E4B] flex items-start gap-2">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Team Form Card */}
      <div className="rounded-2xl border border-white/10 bg-[#0D0E12] p-6 shadow-xl space-y-4">
        {/* Workspace Owner Row (Fixed) */}
        <div className="p-3.5 rounded-xl border border-white/10 bg-white/[0.02] flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-full bg-[#F24E4B] text-black flex items-center justify-center font-bold text-xs">
              {ownerName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <span className="font-semibold text-white block">{ownerName}</span>
              <span className="text-white/50 font-mono text-[11px]">{ownerEmail}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono">
            <ShieldCheck className="size-3" />
            <span>Workspace Owner (Admin)</span>
          </div>
        </div>

        {/* Dynamic Member Rows */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/40 block">
              Additional Members ({members.length} of {maxAdditionalSeats}):
            </span>
            <span className="text-[10px] text-white/40 font-mono">
              Role selection required
            </span>
          </div>

          {members.map((member, index) => (
            <div
              key={member.id}
              className="p-4 rounded-xl border border-white/10 bg-white/[0.015] hover:border-white/20 transition-colors space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/80 font-mono">
                  Member #{index + 1}
                </span>
                {members.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(member.id)}
                    title="Remove member"
                    className="text-white/40 hover:text-red-400 p-1 rounded-md hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative">
                  <label className="block text-[10px] text-white/50 mb-1 font-mono">
                    Full Name *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={member.name}
                      onChange={(e) => updateRow(member.id, "name", e.target.value)}
                      placeholder="e.g. Sam Rivera"
                      className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B]"
                    />
                    <User className="size-3.5 text-white/40 absolute left-2.5 top-2.5 pointer-events-none" />
                  </div>
                </div>

                <div className="relative">
                  <label className="block text-[10px] text-white/50 mb-1 font-mono">
                    Email Address *
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={member.email}
                      onChange={(e) => updateRow(member.id, "email", e.target.value)}
                      placeholder="sam@company.com"
                      className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B]"
                    />
                    <Mail className="size-3.5 text-white/40 absolute left-2.5 top-2.5 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Role Selector with 60-70 roles */}
              <div>
                <label className="block text-[10px] text-white/50 mb-1 font-mono flex items-center gap-1.5">
                  <Briefcase className="size-3 text-white/40" />
                  <span>Professional Role * (60–70 Industry Catalogue)</span>
                </label>
                <RoleSelector
                  value={member.role}
                  customValue={member.customRole}
                  onChange={(role, custom) => {
                    updateRow(member.id, "role", role);
                    if (custom !== undefined) {
                      updateRow(member.id, "customRole", custom);
                    }
                  }}
                  placeholder="Search or browse role categories..."
                />
              </div>
            </div>
          ))}

          {/* Add member action button */}
          {members.length < maxAdditionalSeats ? (
            <button
              type="button"
              onClick={addRow}
              className="w-full py-2.5 border border-dashed border-white/20 hover:border-[#F24E4B] hover:bg-[#F24E4B]/5 rounded-xl text-xs font-medium text-white/70 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="size-3.5 text-[#F24E4B]" />
              <span>Add Another Member ({remainingSeats} seats left)</span>
            </button>
          ) : (
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 text-center">
              You have reached your plan limit of {maxAdditionalSeats} additional members. You can upgrade to RF Ultra later for up to 10 members.
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => router.push("/onboarding/business")}
              className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              <span>Back</span>
            </button>

            <button
              type="button"
              onClick={() => handleSaveTeam(true)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white py-2 px-3 rounded-lg transition-colors"
            >
              <SkipForward className="size-3.5" />
              <span>Skip for now</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleSaveTeam(false)}
            disabled={saving}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#F24E4B] hover:bg-[#d63f3c] text-white py-2.5 px-6 text-xs sm:text-sm font-semibold tracking-wide shadow-lg shadow-[#F24E4B]/20 disabled:opacity-50 transition-all cursor-pointer"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Issuing Invitations...</span>
              </>
            ) : (
              <>
                <span>Save Team & View Badges</span>
                <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
