"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Mail,
  KeyRound,
  ShieldCheck,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Save,
} from "lucide-react";

interface SettingsViewProps {
  initialAdmin: {
    id: string;
    name: string;
    email: string;
    mfaEnabled: boolean;
    mfaEnrolledAt: string | null;
  };
}

export function SettingsView({ initialAdmin }: SettingsViewProps) {
  const router = useRouter();
  const [admin, setAdmin] = useState(initialAdmin);

  // Profile form
  const [name, setName] = useState(initialAdmin.name);
  const [email, setEmail] = useState(initialAdmin.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password form
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setProfileSaving(true);

    try {
      const res = await fetch("/api/console/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newName: name,
          newEmail: email,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setProfileMsg({ type: "error", text: data.error || "Failed to update profile." });
        return;
      }

      setAdmin((prev) => ({
        ...prev,
        name: data.admin?.name || name,
        email: data.admin?.email || email,
      }));
      setCurrentPassword("");
      setProfileMsg({ type: "success", text: "Profile details updated successfully." });
      router.refresh();
    } catch {
      setProfileMsg({ type: "error", text: "Network error. Please try again." });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);

    if (newPassword.length < 12) {
      setPwdMsg({ type: "error", text: "New password must be at least 12 characters long." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdMsg({ type: "error", text: "New passwords do not match." });
      return;
    }

    setPwdSaving(true);
    try {
      const res = await fetch("/api/console/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: pwdCurrent,
          newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setPwdMsg({ type: "error", text: data.error || "Failed to update password." });
        return;
      }

      setPwdCurrent("");
      setNewPassword("");
      setConfirmPassword("");
      setPwdMsg({ type: "success", text: "Password changed successfully." });
    } catch {
      setPwdMsg({ type: "error", text: "Network error. Please try again." });
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Admin Account Settings</h1>
        <p className="text-xs text-text-muted mt-1">
          Manage your console operator credentials, email address, and security factors.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column: Security status */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-white/10 bg-console-panel p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
              Operator Identity
            </h2>
            <div className="flex flex-col gap-2.5 text-xs">
              <div>
                <span className="text-text-muted block text-[11px]">Admin ID</span>
                <span className="font-mono text-white text-[11px] select-all break-all">{admin.id}</span>
              </div>
              <div>
                <span className="text-text-muted block text-[11px]">Display Name</span>
                <span className="font-medium text-white">{admin.name}</span>
              </div>
              <div>
                <span className="text-text-muted block text-[11px]">Email</span>
                <span className="font-mono text-white text-[11px]">{admin.email}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-console-panel p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <h2 className="text-xs font-semibold text-white">2-Factor Authentication</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
                <Check className="h-3 w-3" />
                TOTP Active
              </span>
            </div>
            <p className="mt-2 text-[11px] text-text-muted leading-relaxed">
              Enforced for all admin logins via your Authenticator app.
            </p>
          </div>
        </div>

        {/* Right column: Update forms */}
        <div className="md:col-span-2 flex flex-col gap-6">
          {/* Profile Form */}
          <form
            onSubmit={handleUpdateProfile}
            className="rounded-xl border border-white/10 bg-console-panel p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <User className="h-4 w-4 text-accent" />
                Change Name & Email
              </h3>
            </div>

            {profileMsg ? (
              <div
                className={`flex items-center gap-2 rounded-lg p-3 text-xs ${
                  profileMsg.type === "success"
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border border-red-500/30 bg-red-500/10 text-red-300"
                }`}
              >
                {profileMsg.type === "success" ? <Check className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                {profileMsg.text}
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-xs text-white placeholder-text-muted outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-xs text-white placeholder-text-muted outline-none focus:border-accent"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Current Password <span className="text-text-muted">(required to confirm changes)</span>
              </label>
              <input
                type="password"
                required
                placeholder="Enter current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-xs text-white placeholder-text-muted outline-none focus:border-accent"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={profileSaving || !currentPassword}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition-all hover:bg-accent-hover disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {profileSaving ? "Saving…" : "Save Profile"}
              </button>
            </div>
          </form>

          {/* Password Form */}
          <form
            onSubmit={handleUpdatePassword}
            className="rounded-xl border border-white/10 bg-console-panel p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-accent" />
                Change Password
              </h3>
            </div>

            {pwdMsg ? (
              <div
                className={`flex items-center gap-2 rounded-lg p-3 text-xs ${
                  pwdMsg.type === "success"
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border border-red-500/30 bg-red-500/10 text-red-300"
                }`}
              >
                {pwdMsg.type === "success" ? <Check className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                {pwdMsg.text}
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Current Password
              </label>
              <input
                type="password"
                required
                placeholder="Enter current password"
                value={pwdCurrent}
                onChange={(e) => setPwdCurrent(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-xs text-white placeholder-text-muted outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  New Password <span className="text-text-muted">(min 12 characters)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 pr-9 text-xs text-white placeholder-text-muted outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-xs text-white placeholder-text-muted outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pwdSaving || !pwdCurrent || !newPassword || newPassword !== confirmPassword}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition-all hover:bg-accent-hover disabled:opacity-50"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {pwdSaving ? "Updating Password…" : "Update Password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
