"use client";

import React from "react";
import {
  TrendingUp,
  AlertTriangle,
  FileText,
  X,
  CheckCircle,
  XCircle,
  PlusSquare,
  Building2,
  Calendar,
  AlertCircle,
  Lightbulb,
  Sparkles,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import type { Insight, InsightSeverity, InsightActionStatus } from "@/app/types/insight";

// ─── Config ───────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  InsightSeverity,
  { chipBg: string; chipText: string; border: string }
> = {
  CRITICAL: {
    chipBg:   "rgba(242,78,75,0.12)",
    chipText: "var(--dash-status-error)",
    border:   "rgba(242,78,75,0.3)",
  },
  WARNING: {
    chipBg:   "rgba(250,204,21,0.12)",
    chipText: "var(--dash-status-paused)",
    border:   "rgba(250,204,21,0.3)",
  },
  INFO: {
    chipBg:   "rgba(96,165,250,0.12)",
    chipText: "var(--dash-chart-secondary)",
    border:   "rgba(96,165,250,0.3)",
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface InsightModalProps {
  insight: Insight | null;
  onClose: () => void;
  /** Called when user clicks Accept / Dismiss / Create Task */
  onAction: (id: string, action: InsightActionStatus) => Promise<void>;
  /** The insightId currently being actioned (shows spinner) */
  actionPending: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InsightModal({ insight, onClose, onAction, actionPending }: InsightModalProps) {
  if (!insight) return null;

  const sev    = SEVERITY_CONFIG[insight.severity];
  const detail = insight.detail;
  const busy   = actionPending === insight.id;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="insight-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--border)] p-5 pb-4">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: sev.chipBg }}
            >
              {insight.type === "RISK" || insight.type === "ANOMALY" ? (
                <AlertTriangle className="size-5" style={{ color: sev.chipText }} />
              ) : insight.type === "OPPORTUNITY" ? (
                <TrendingUp className="size-5" style={{ color: sev.chipText }} />
              ) : (
                <FileText className="size-5" style={{ color: sev.chipText }} />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span
                  className="rounded-xs px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider"
                  style={{ background: sev.chipBg, color: sev.chipText }}
                >
                  {insight.severity.toLowerCase()}
                </span>
                <span className="rounded-xs px-2 py-0.5 text-[10px] font-mono uppercase bg-[var(--surface-elevated)] text-[var(--text-muted)]">
                  {insight.type.toLowerCase()}
                </span>
                {insight.accountName && (
                  <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <Building2 className="size-3" />
                    {insight.accountName}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                  <Calendar className="size-3" />
                  {new Date(insight.createdAt).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>
              <h2
                id="insight-modal-title"
                className="text-lg font-semibold text-[var(--text-primary)] leading-snug"
              >
                {insight.title}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Status banner if already actioned */}
        {insight.actionStatus && (
          <div
            className={`px-5 py-2 text-xs font-medium flex items-center gap-2 ${
              insight.actionStatus === "ACCEPTED"
                ? "bg-emerald-500/10 text-emerald-400 border-b border-emerald-500/20"
                : insight.actionStatus === "DISMISSED"
                ? "bg-zinc-500/10 text-zinc-400 border-b border-zinc-500/20"
                : "bg-blue-500/10 text-blue-400 border-b border-blue-500/20"
            }`}
          >
            {insight.actionStatus === "ACCEPTED"     && <CheckCircle className="size-4" />}
            {insight.actionStatus === "DISMISSED"    && <XCircle     className="size-4" />}
            {insight.actionStatus === "TASK_CREATED" && <PlusSquare  className="size-4" />}
            Status: {insight.actionStatus.replace("_", " ")}
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* What Happened + Why Detected */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                <AlertCircle className="size-4 text-[var(--accent)]" />
                What Happened
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {detail.whatHappened}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                <Sparkles className="size-4 text-violet-400" />
                Why RF Detected It
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {detail.whyDetected}
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">{detail.chartTitle}</h3>
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase">Supporting Data</span>
            </div>
            <div className="h-52 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                {detail.chartType === "bar" ? (
                  <BarChart data={detail.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" stroke="#888888" fontSize={11} />
                    <YAxis stroke="#888888" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46", borderRadius: "8px", fontSize: "12px" }} />
                    <Bar dataKey="value" fill="var(--accent)" radius={[4,4,0,0]} name="Value" />
                    {detail.chartData[0]?.benchmark !== undefined && (
                      <Bar dataKey="benchmark" fill="#52525b" radius={[4,4,0,0]} name="Threshold" />
                    )}
                  </BarChart>
                ) : detail.chartType === "line" ? (
                  <LineChart data={detail.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" stroke="#888888" fontSize={11} />
                    <YAxis stroke="#888888" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46", borderRadius: "8px", fontSize: "12px" }} />
                    <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 4 }} />
                    {detail.chartData[0]?.benchmark !== undefined && (
                      <Line type="monotone" dataKey="benchmark" stroke="#71717a" strokeDasharray="4 4" />
                    )}
                  </LineChart>
                ) : (
                  <AreaChart data={detail.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" stroke="#888888" fontSize={11} />
                    <YAxis stroke="#888888" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46", borderRadius: "8px", fontSize: "12px" }} />
                    <Area type="monotone" dataKey="value" stroke="#f43f5e" fill="rgba(244,63,94,0.15)" />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Business Impact + Recommended Action */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-1.5">
              <div className="text-xs font-semibold text-amber-400">Business Impact</div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">{detail.businessImpact}</p>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <Lightbulb className="size-4" />
                Recommended Action
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">{detail.recommendedAction}</p>
            </div>
          </div>
        </div>

        {/* Action footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] p-4 bg-[var(--surface-elevated)]/40">
          <button
            onClick={() => void onAction(insight.id, "DISMISSED")}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-rose-400 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
            Dismiss
          </button>

          <div className="flex items-center gap-2">
            {insight.actionStatus === "TASK_CREATED" ? (
              <span className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3.5 py-2 text-xs font-medium text-blue-400">
                <PlusSquare className="size-4 text-blue-400" />
                Task Created
              </span>
            ) : (
              <button
                onClick={() => void onAction(insight.id, "TASK_CREATED")}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <PlusSquare className="size-4 text-blue-400" />}
                Create Task
              </button>
            )}
            <button
              onClick={() => void onAction(insight.id, "ACCEPTED")}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors shadow-sm disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
              Accept Recommendation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
