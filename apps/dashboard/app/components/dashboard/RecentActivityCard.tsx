"use client";

import * as React from "react";
import { StatCard } from "./StatCard";
import type { DashboardActivity } from "@/app/types/dashboard";
import { Activity } from "lucide-react";

interface RecentActivityCardProps {
  activities: DashboardActivity[];
  delta?: string;
  deltaValue?: number;
  period?: string;
}

export function RecentActivityCard({
  activities,
  delta,
  deltaValue,
  period,
}: RecentActivityCardProps) {
  const displayActivities = activities.slice(0, 3);

  return (
    <StatCard
      title="Recent Activity"
      value={activities.length > 0 ? `${activities.length} logged` : "0 logged"}
      delta={delta}
      deltaValue={deltaValue}
      period={period ?? "in workspace"}
    >
      <div
        role="region"
        aria-label="Recent activity updates"
        className="w-full flex flex-col justify-between h-full pt-1"
      >
        {displayActivities.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-4 text-center">
            <Activity className="size-6 text-zinc-500 mb-1.5" />
            <p className="text-xs font-semibold text-[var(--text-primary)]">No Activity Yet</p>
            <p className="text-[11px] text-[var(--text-muted)]">Actions in this workspace will appear here</p>
          </div>
        ) : (
          <div className="space-y-2 flex-1 flex flex-col justify-center py-0.5">
            {displayActivities.map((act) => (
              <div
                key={act.id}
                className="flex items-start gap-2.5 p-2 rounded bg-white/[0.02] border border-white/5 hover:border-white/15 transition-colors"
              >
                <div className="size-6 shrink-0 rounded bg-white/10 flex items-center justify-center font-mono font-bold text-[10px] text-[var(--text-primary)] border border-white/10">
                  {act.authorInitials || "RF"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-mono font-semibold text-[var(--accent)] truncate max-w-[110px]">
                      {act.projectName}
                    </span>
                    <span className="text-[9px] font-mono text-[var(--text-muted)] shrink-0">
                      {act.relativeTime}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-primary)] truncate font-medium">
                    {act.action}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </StatCard>
  );
}
