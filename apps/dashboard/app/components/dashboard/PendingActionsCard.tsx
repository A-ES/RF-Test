"use client";

import * as React from "react";
import { StatCard } from "./StatCard";
import type { PendingActionStats } from "@/app/types/dashboard";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/app/lib/utils";

interface PendingActionsCardProps {
  stats: PendingActionStats;
  delta?: string;
  deltaValue?: number;
  period?: string;
}

export function PendingActionsCard({
  stats,
  delta,
  deltaValue,
  period,
}: PendingActionsCardProps) {
  const actionItems = [
    {
      label: "Open Tasks",
      count: stats.openTasks,
      color: "bg-amber-400",
    },
    {
      label: "Escalations",
      count: stats.escalations,
      color: "bg-violet-400",
    },
  ];

  const signalItems = [
    {
      label: "Unread Insights",
      count: stats.unreadInsights,
      color: "bg-red-400",
    },
    {
      label: "At-Risk Projects",
      count: stats.atRiskProjects,
      color: "bg-yellow-400",
    },
  ];

  return (
    <StatCard
      title="Pending Actions"
      value={stats.total}
      delta={delta}
      deltaValue={deltaValue}
      period={period ?? `${stats.actionableTasks} action items · ${stats.reviewSignals} signals`}
    >
      <div
        role="region"
        aria-label={`Pending actions: ${stats.actionableTasks} action items, ${stats.reviewSignals} review signals`}
        className="w-full flex flex-col justify-between h-full pt-1"
      >
        {stats.total === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-4 text-center">
            <CheckCircle2 className="size-6 text-green-400 mb-1.5" />
            <p className="text-xs font-semibold text-[var(--text-primary)]">All clear</p>
            <p className="text-[11px] text-[var(--text-muted)]">Zero pending client actions</p>
          </div>
        ) : (
          <div className="space-y-2 flex-1 flex flex-col justify-center py-0.5">
            <div>
              <div className="flex items-center justify-between px-1 mb-1 text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                <span>Action Items</span>
                <span>{stats.actionableTasks}</span>
              </div>
              <div className="space-y-1">
                {actionItems.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between px-2 py-1 rounded bg-white/[0.02] border border-white/5 hover:border-white/15 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn("size-1.5 rounded-full", item.color)} />
                      <span className="text-[11px] font-mono text-[var(--text-secondary)]">{item.label}</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-[var(--text-primary)]">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between px-1 mb-1 text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                <span>Review Signals</span>
                <span>{stats.reviewSignals}</span>
              </div>
              <div className="space-y-1">
                {signalItems.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between px-2 py-1 rounded bg-white/[0.02] border border-white/5 hover:border-white/15 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn("size-1.5 rounded-full", item.color)} />
                      <span className="text-[11px] font-mono text-[var(--text-secondary)]">{item.label}</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-[var(--text-primary)]">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </StatCard>
  );
}
