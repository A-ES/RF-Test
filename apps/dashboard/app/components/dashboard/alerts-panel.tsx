"use client";

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import type { DashboardAlert } from "@/app/types/dashboard";
import { AlertToast } from "@/app/components/ui/alert-toast";
import { Button } from "@/app/components/ui/button";

interface AlertsPanelProps {
  alerts: DashboardAlert[];
}

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export function AlertsPanel({ alerts: initialAlerts }: AlertsPanelProps) {
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [showAll, setShowAll] = React.useState(false);

  // Sync when parent updates alert data
  const visible = React.useMemo(() => {
    const list = initialAlerts.filter((a) => !dismissed.has(a.id));
    return [...list].sort((a, b) => {
      const weightDiff = (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0);
      return weightDiff;
    });
  }, [initialAlerts, dismissed]);

  function handleDismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
  }

  const displayedAlerts = showAll ? visible : visible.slice(0, 3);
  const hasMore = visible.length > 3;

  return (
    <section aria-labelledby="alerts-heading" className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="dash-eyebrow">/ alerts</p>
          <h2
            id="alerts-heading"
            className="mt-0.5 text-base font-semibold text-[var(--text-primary)] tracking-tight"
          >
            Important Alerts {visible.length > 0 ? `(${visible.length} require attention)` : "— All Clear"}
          </h2>
        </div>

        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((s) => !s)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] gap-1 h-7 px-2.5"
          >
            <span>{showAll ? "Show less" : `Show all (${visible.length})`}</span>
            {showAll ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-green-500/20 bg-green-950/10 p-4 flex items-center gap-3 text-green-400">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">You&apos;re all clear.</p>
            <p className="text-xs text-[var(--text-muted)]">No pending risks or blocked projects at this time.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false} mode="popLayout">
            {displayedAlerts.map((alert) => {
              const variant =
                alert.severity === "critical"
                  ? "error"
                  : alert.severity === "warning"
                  ? "warning"
                  : "info";

              const styleVariant = alert.severity === "critical" ? "filled" : "default";

              return (
                <AlertToast
                  key={alert.id}
                  variant={variant}
                  styleVariant={styleVariant}
                  title={alert.title}
                  description={alert.body}
                  className="max-w-none w-full"
                  severityTag={alert.severity.toUpperCase()}
                  onClose={() => handleDismiss(alert.id)}
                  action={
                    alert.ctaHref && alert.ctaLabel
                      ? {
                          label: `${alert.ctaLabel} →`,
                          href: alert.ctaHref,
                        }
                      : undefined
                  }
                />
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
