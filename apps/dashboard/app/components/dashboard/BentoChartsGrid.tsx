"use client";

import * as React from "react";
import type { DashboardData, AIProcessStats, PendingActionStats } from "@/app/types/dashboard";
import { ProjectStatusBars } from "./ProjectStatusBars";
import { AITasksProcessesCard } from "./AITasksProcessesCard";
import { InsightsSparkline } from "./InsightsSparkline";
import { PendingActionsCard } from "./PendingActionsCard";
import { RecentActivityCard } from "./RecentActivityCard";
import { AcceptanceGauge } from "./AcceptanceGauge";
import { ConversationsMini } from "./ConversationsMini";
import { TeamRoleDonut } from "./TeamRoleDonut";
import {
  deriveProjectStatusCounts,
  deriveConversationsHistory,
  deriveInsightsHistory,
  deriveTeamRoles,
} from "@/app/lib/dashboard-mock";

import { AlertTriangle, RefreshCw } from "lucide-react";

interface BentoChartsGridProps {
  data: DashboardData;
  onRetry?: () => void;
}

function SectionErrorFallback({
  title,
  onRetry,
}: {
  title: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-6 h-full min-h-[220px] rounded-xl border border-rose-500/20 bg-rose-500/5 text-center gap-3">
      <div className="flex items-center gap-2 text-xs font-medium text-rose-400">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <span>Failed to load {title}</span>
      </div>
      <p className="text-[11px] text-[var(--text-muted)] max-w-[220px]">
        Database query timed out. Click retry to refresh this section.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-white/10 transition-colors"
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}

export function BentoChartsGrid({ data, onRetry }: BentoChartsGridProps) {
  const errors = data.errors;
  const countErrors = errors?.counts;

  // Find metric cards by id (truthful fallbacks: 0 instead of 94%)
  const projectCard = data.metricCards.find((c) => c.id === "mc_projects") ?? {
    rawValue: data.projects.length,
    delta: "0",
    deltaValue: 0,
    period: "vs last month",
  };

  const aiCard = data.metricCards.find((c) => c.id === "mc_ai_processes") ?? {
    rawValue: data.aiProcessStats?.total ?? 0,
    delta: "+0",
    deltaValue: 0,
    period: "active in pipeline",
  };

  const insightsCard = data.metricCards.find((c) => c.id === "mc_insights") ?? {
    rawValue: data.insights.length,
    delta: "+0",
    deltaValue: 0,
    period: "last 30 days",
  };

  const pendingCard = data.metricCards.find((c) => c.id === "mc_pending_actions") ?? {
    rawValue: data.pendingActionStats?.total ?? 0,
    delta: "0",
    deltaValue: 0,
    period: "requiring review",
  };

  const renewalCard = data.metricCards.find((c) => c.id === "mc_renewal") ?? {
    rawValue: 0,
    delta: "0%",
    deltaValue: 0,
    period: "this quarter",
  };

  const convCard = data.metricCards.find((c) => c.id === "mc_conversations") ?? {
    rawValue: data.recentConversations.length,
    delta: "+0",
    deltaValue: 0,
    period: "since yesterday",
  };

  const teamCard = data.metricCards.find((c) => c.id === "mc_team") ?? {
    rawValue: data.teamRoles?.total ?? 0,
    delta: "0",
    deltaValue: 0,
    period: "in this workspace",
  };

  // Derive visual breakdowns using typed database selectors or fallback helpers
  const projectCounts = React.useMemo(
    () => deriveProjectStatusCounts(data.projects, projectCard.rawValue, data.projectStatusCounts),
    [data.projects, projectCard.rawValue, data.projectStatusCounts]
  );

  const aiProcessStats: AIProcessStats = data.aiProcessStats ?? {
    queued: 0,
    processing: 0,
    activeConversations: 0,
    active: 0,
    completed: 0,
    failed: 0,
    total: aiCard.rawValue,
  };

  const pendingActionStats: PendingActionStats = data.pendingActionStats ?? {
    actionableTasks: 0,
    reviewSignals: data.unreadInsightCount ?? 0,
    total: pendingCard.rawValue,
    openTasks: 0,
    unreadInsights: data.unreadInsightCount ?? 0,
    escalations: 0,
    atRiskProjects: 0,
  };

  const recentActivities = data.recentActivities ?? [];

  const convHistory = React.useMemo(
    () => deriveConversationsHistory(data.recentConversations, convCard.rawValue, data.conversationHistory),
    [data.recentConversations, convCard.rawValue, data.conversationHistory]
  );

  const insightsHistory = React.useMemo(
    () => deriveInsightsHistory(data.insights, insightsCard.rawValue, data.insightHistory),
    [data.insights, insightsCard.rawValue, data.insightHistory]
  );

  const teamRoles = React.useMemo(
    () => deriveTeamRoles(teamCard.rawValue, data.teamRoles),
    [teamCard.rawValue, data.teamRoles]
  );

  return (
    <section aria-label="Dashboard Overview" className="w-full space-y-8">
      {/* Primary Information Architecture (Client Requirements 1–5) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Requirement 1: Active Projects (8 cols) */}
        <div className="md:col-span-7 lg:col-span-8 min-h-[260px]">
          {errors?.projects || countErrors?.projects ? (
            <SectionErrorFallback title="Active Projects" onRetry={onRetry} />
          ) : (
            <ProjectStatusBars
              counts={projectCounts}
              delta={projectCard.delta}
              deltaValue={projectCard.deltaValue}
              period={projectCard.period}
            />
          )}
        </div>

        {/* Requirement 2: AI Tasks / Processes (4 cols) */}
        <div className="md:col-span-5 lg:col-span-4 min-h-[260px]">
          {countErrors?.aiProcesses ? (
            <SectionErrorFallback title="AI Tasks / Processes" onRetry={onRetry} />
          ) : (
            <AITasksProcessesCard
              stats={aiProcessStats}
              delta={aiCard.delta}
              deltaValue={aiCard.deltaValue}
              period={aiCard.period}
            />
          )}
        </div>

        {/* Requirement 3: Insights Generated (4 cols) */}
        <div className="md:col-span-12 lg:col-span-4 min-h-[240px]">
          {errors?.insights || countErrors?.insights ? (
            <SectionErrorFallback title="Insights Generated" onRetry={onRetry} />
          ) : (
            <InsightsSparkline
              title="Insights Generated"
              total={insightsCard.rawValue}
              delta={insightsCard.delta}
              deltaValue={insightsCard.deltaValue}
              period={insightsCard.period}
              history={insightsHistory}
            />
          )}
        </div>

        {/* Requirement 4: Pending Actions (4 cols) */}
        <div className="md:col-span-6 lg:col-span-4 min-h-[240px]">
          {countErrors?.pendingActions ? (
            <SectionErrorFallback title="Pending Actions" onRetry={onRetry} />
          ) : (
            <PendingActionsCard
              stats={pendingActionStats}
              delta={pendingCard.delta}
              deltaValue={pendingCard.deltaValue}
              period={pendingCard.period}
            />
          )}
        </div>

        {/* Requirement 5: Recent Activity (4 cols) */}
        <div className="md:col-span-6 lg:col-span-4 min-h-[240px]">
          {errors?.activities ? (
            <SectionErrorFallback title="Recent Activity" onRetry={onRetry} />
          ) : (
            <RecentActivityCard
              activities={recentActivities}
              period="in workspace"
            />
          )}
        </div>
      </div>

      {/* Secondary Operations Metrics (Acceptance Rate, Conversations, Team) */}
      <div className="space-y-4 pt-4 border-t border-white/10">
        <div>
          <p className="dash-eyebrow">/ telemetry</p>
          <h3 className="mt-0.5 text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Workspace Operations
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Secondary 1: Acceptance Rate (4 cols) */}
          <div className="md:col-span-12 lg:col-span-4 min-h-[240px]">
            {countErrors?.renewal ? (
              <SectionErrorFallback title="Acceptance Rate" onRetry={onRetry} />
            ) : (
              <AcceptanceGauge
                rate={renewalCard.rawValue}
                delta={renewalCard.delta}
                deltaValue={renewalCard.deltaValue}
                period={renewalCard.period}
              />
            )}
          </div>

          {/* Secondary 2: Open Conversations (4 cols) */}
          <div className="md:col-span-6 lg:col-span-4 min-h-[240px]">
            {errors?.conversations || countErrors?.conversations ? (
              <SectionErrorFallback title="Open Conversations" onRetry={onRetry} />
            ) : (
              <ConversationsMini
                total={convCard.rawValue}
                delta={convCard.delta}
                deltaValue={convCard.deltaValue}
                period={convCard.period}
                history={convHistory}
              />
            )}
          </div>

          {/* Secondary 3: Team Members (4 cols) */}
          <div className="md:col-span-6 lg:col-span-4 min-h-[240px]">
            {countErrors?.team ? (
              <SectionErrorFallback title="Team Breakdown" onRetry={onRetry} />
            ) : (
              <TeamRoleDonut
                roles={teamRoles}
                delta={teamCard.delta}
                deltaValue={teamCard.deltaValue}
                period={teamCard.period}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
