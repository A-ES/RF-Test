"use client";

import { useDashboard } from "@/app/lib/use-dashboard";
import { Loader2 } from "lucide-react";
import { DashboardHeader } from "@/app/components/dashboard/DashboardHeader";
import { BentoChartsGrid } from "@/app/components/dashboard/BentoChartsGrid";
import { AlertsPanel } from "@/app/components/dashboard/alerts-panel";
import { Separator } from "@/app/components/ui/separator";

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-10 animate-pulse">
      {/* Header skeleton */}
      <div className="space-y-3">
        <div className="h-3.5 w-24 bg-[var(--surface-elevated)] rounded" />
        <div className="h-10 w-72 sm:w-96 bg-[var(--surface-elevated)] rounded-lg" />
        <div className="h-4 w-60 bg-[var(--surface-elevated)] rounded" />
      </div>

      {/* Bento grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-7 lg:col-span-8 h-64 bg-[var(--surface-elevated)] rounded-xl border border-white/5" />
        <div className="md:col-span-5 lg:col-span-4 h-64 bg-[var(--surface-elevated)] rounded-xl border border-white/5" />
        <div className="md:col-span-12 lg:col-span-5 h-60 bg-[var(--surface-elevated)] rounded-xl border border-white/5" />
        <div className="md:col-span-6 lg:col-span-4 h-60 bg-[var(--surface-elevated)] rounded-xl border border-white/5" />
        <div className="md:col-span-6 lg:col-span-3 h-60 bg-[var(--surface-elevated)] rounded-xl border border-white/5" />
      </div>

      {/* Alerts skeleton */}
      <div className="space-y-3 pt-2">
        <div className="h-4 w-28 bg-[var(--surface-elevated)] rounded" />
        <div className="h-20 w-full bg-[var(--surface-elevated)] rounded-lg border border-white/5" />
        <div className="h-20 w-full bg-[var(--surface-elevated)] rounded-lg border border-white/5" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data, isLoading, mutate } = useDashboard();

  if (isLoading && !data) return <DashboardSkeleton />;

  if (!data) {
    return (
      <div className="mx-auto max-w-[1200px] flex flex-col items-center justify-center py-24 text-xs text-[var(--text-muted)] gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span>Unable to reach dashboard data.</span>
        </div>
        <button
          type="button"
          onClick={() => void mutate()}
          className="px-3 py-1.5 rounded-md bg-[var(--surface-elevated)] hover:bg-[var(--surface)] text-[var(--text-primary)] border border-white/10 text-xs font-mono transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Active project count from metricCards or projects list
  const activeProjectsCount =
    data.metricCards?.find((c) => c.id === "mc_projects")?.rawValue ??
    data.projects?.filter((p) => p.status !== "COMPLETED").length ?? 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-10">
      {/* 1. Header */}
      <DashboardHeader
        userName={data.userName}
        activeProjectsCount={activeProjectsCount}
        alertsCount={data.alerts?.length ?? 0}
        unreadInsightCount={data.unreadInsightCount ?? 0}
        organizationName={data.organizationName}
        businessType={data.businessType}
      />

      {/* Operational Telemetry Banner (Configured during onboarding) */}
      {data.operationalProfile && (
        <div className="rounded-xl border border-white/10 bg-[#0D0E12] p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs shadow-md">
          <div className="flex items-center gap-3">
            <div className="size-2 rounded-full bg-[#F24E4B] animate-pulse" />
            <div>
              <span className="font-semibold text-white">
                Active Telemetry Focus ({data.businessType || "Wholesale"}):
              </span>{" "}
              <span className="text-white/70">
                {data.operationalProfile.monitoringAreas?.slice(0, 2).join(" · ") || "Order intake & Stock velocity"}
              </span>
            </div>
          </div>

          {data.operationalProfile.priorities && data.operationalProfile.priorities.length > 0 && (
            <div className="text-[11px] font-mono text-[#F24E4B] bg-[#F24E4B]/10 px-2.5 py-1 rounded border border-[#F24E4B]/20">
              Priority: {data.operationalProfile.priorities[0]}
            </div>
          )}
        </div>
      )}

      {/* Clean Zero-Data Workspace Guidance (For freshly onboarded organizations) */}
      {activeProjectsCount === 0 && (!data.projects || data.projects.length === 0) && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center space-y-3">
          <h3 className="text-sm font-semibold text-white">
            Workspace Initialized for {data.organizationName || "Your Organization"}
          </h3>
          <p className="text-xs text-white/60 max-w-lg mx-auto">
            Your telemetry profile is active. Add your first wholesale order, document, or customer conversation to begin populating live telemetry cards.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href="/conversations"
              className="px-3.5 py-1.5 rounded-lg bg-[#F24E4B] text-white font-medium text-xs hover:bg-[#d63f3c] transition-colors"
            >
              Start Customer Conversation
            </a>
            <a
              href="/onboarding/presentation"
              className="px-3.5 py-1.5 rounded-lg bg-white/5 text-white/80 border border-white/10 font-medium text-xs hover:bg-white/10 transition-colors"
            >
              View Team Lanyard Badges
            </a>
          </div>
        </div>
      )}

      <Separator className="bg-[var(--border)]" />

      {/* 2. Bento Stats Grid */}
      <BentoChartsGrid data={data} onRetry={() => void mutate()} />

      <Separator className="bg-[var(--border)]" />

      {/* 3. Alerts Section */}
      <AlertsPanel alerts={data.alerts ?? []} />
    </div>
  );
}
