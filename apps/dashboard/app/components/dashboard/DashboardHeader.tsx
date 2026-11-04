"use client";

import * as React from "react";

interface DashboardHeaderProps {
  userName: string;
  activeProjectsCount: number;
  alertsCount: number;
  unreadInsightCount: number;
  organizationName?: string;
  businessType?: string;
}

export function DashboardHeader({
  userName,
  activeProjectsCount,
  alertsCount,
  unreadInsightCount,
  organizationName,
  businessType,
}: DashboardHeaderProps) {
  // Client-only state for time-aware greeting and date to avoid hydration mismatches
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const now = React.useMemo(() => (mounted ? new Date() : null), [mounted]);
  const hour = now ? now.getHours() : 9;

  const greeting =
    hour >= 5 && hour < 12
      ? "Good morning"
      : hour >= 12 && hour < 17
      ? "Good afternoon"
      : "Good evening";

  const formattedDate = now
    ? now
        .toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
        .toUpperCase()
    : "";


  const firstName = userName ? userName.trim().split(" ")[0] : "there";

  return (
    <header className="relative w-full overflow-hidden pb-2">
      {/* Faint red radial glow behind the header for depth */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -left-12 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(242,78,75,0.14)_0%,transparent_70%)] blur-2xl"
      />

      <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          {/* Eyebrow */}
          <div className="flex items-center gap-2 mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            <span>/ OVERVIEW</span>
            {organizationName && (
              <>
                <span>&bull;</span>
                <span className="text-white font-medium">{organizationName}</span>
              </>
            )}
            {businessType && (
              <>
                <span>&bull;</span>
                <span className="text-[#F24E4B]">{businessType}</span>
              </>
            )}
          </div>

          {/* Large Greeting with red-to-orange gradient and subtle animated shine */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-[var(--text-primary)]">
            {greeting},{" "}
            <span className="bg-gradient-to-r from-[#F24E4B] via-[#FB7185] to-[#F97316] bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient-shine">
              {firstName}.
            </span>
          </h1>

          {/* Contextual Live Sentence */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[var(--text-muted)] font-medium">
            <span>
              {activeProjectsCount} active project{activeProjectsCount !== 1 ? "s" : ""}
            </span>
            <span className="text-[var(--border-strong)]">·</span>
            <span className={alertsCount > 0 ? "text-amber-400 font-semibold" : ""}>
              {alertsCount} alert{alertsCount !== 1 ? "s" : ""}{" "}
              {alertsCount === 0 ? "pending" : "need attention"}
            </span>
            <span className="text-[var(--border-strong)]">·</span>

            {/* Red-tinted soft pill with pulsing dot */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-950/30 px-2.5 py-0.5 text-xs font-semibold text-red-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              <span>
                {unreadInsightCount} new insight{unreadInsightCount !== 1 ? "s" : ""}
              </span>
            </span>
          </div>
        </div>

        {/* Date on right side in mono uppercase (desktop only) */}
        {formattedDate && (
          <div
            className="hidden md:flex flex-col items-end pb-1"
            aria-label={`Today is ${formattedDate}`}
          >
            <span className="text-[10px] font-mono tracking-widest text-[var(--text-muted)] uppercase">
              Current Session
            </span>
            <span className="text-xs font-mono font-bold tracking-wider text-[var(--text-secondary)]">
              {formattedDate}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
