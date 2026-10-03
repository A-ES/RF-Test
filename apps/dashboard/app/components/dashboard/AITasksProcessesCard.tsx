"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StatCard } from "./StatCard";
import type { AIProcessStats } from "@/app/types/dashboard";
import { cn } from "@/app/lib/utils";
import { Bot } from "lucide-react";

interface AITasksProcessesCardProps {
  stats: AIProcessStats;
  delta?: string;
  deltaValue?: number;
  period?: string;
}

interface StatusItem {
  id: string;
  label: string;
  value: number;
  description: string;
  color: string;
}

export function AITasksProcessesCard({
  stats,
  delta,
  deltaValue,
  period,
}: AITasksProcessesCardProps) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  const items: StatusItem[] = [
    {
      id: "queued",
      label: "QUEUED",
      value: stats.queued,
      description: "Queued documents & reports",
      color: "bg-amber-400",
    },
    {
      id: "aichat",
      label: "AI CHAT",
      value: stats.activeConversations,
      description: "Active AI customer conversations",
      color: "bg-violet-400",
    },
    {
      id: "completed",
      label: "COMPLETED",
      value: stats.completed,
      description: "Completed operations",
      color: "bg-green-500",
    },
    {
      id: "failed",
      label: "FAILED",
      value: stats.failed,
      description: "Failed operations",
      color: stats.failed > 0 ? "bg-red-500" : "bg-zinc-600",
    },
  ];

  const maxValue = Math.max(...items.map((i) => i.value), 1);
  const total = stats.total;

  return (
    <StatCard
      title="AI Tasks / Processes"
      value={total}
      delta={delta}
      deltaValue={deltaValue}
      period={period ?? `${stats.queued} queued · ${stats.activeConversations} AI active`}
    >
      <div
        role="region"
        aria-label={`AI Tasks and Processes: ${items.map((i) => `${i.label} ${i.value}`).join(", ")}`}
        className="w-full flex flex-col justify-between h-full pt-2"
      >
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-4 text-center">
            <Bot className="size-6 text-zinc-500 mb-1.5" />
            <p className="text-xs font-semibold text-[var(--text-primary)]">Pipeline Idle</p>
            <p className="text-[11px] text-[var(--text-muted)]">No active AI extraction jobs</p>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-3 sm:gap-4 flex-1 min-h-[120px] pb-2">
            {items.map((item, i) => {
              const heightPercent = Math.max(14, Math.round((item.value / maxValue) * 100));
              const isHovered = hovered === i;
              const isDimmed = hovered !== null && !isHovered;

              return (
                <div
                  key={item.id}
                  className="relative flex-1 h-full flex flex-col justify-end items-center group cursor-pointer"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {/* Tooltip on hover */}
                  <AnimatePresence>
                    {isHovered && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.15 }}
                        className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black text-white px-2.5 py-1 text-xs font-mono font-bold whitespace-nowrap border border-white/30 z-30 pointer-events-none rounded shadow-md"
                      >
                        {item.label}: {item.value}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Animated Brutalist Bar */}
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{
                      height: `${heightPercent}%`,
                      opacity: isDimmed ? 0.35 : 1,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 220,
                      damping: 24,
                      delay: i * 0.05,
                    }}
                    whileHover={{ scaleY: 1.05 }}
                    className={cn(
                      "w-full border-2 border-black dark:border-white/40 relative z-10 origin-bottom flex items-center justify-center rounded-t-md overflow-hidden",
                      item.color
                    )}
                  >
                    <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:4px_4px]" />
                    <span className="relative z-20 font-mono font-bold text-xs text-black">
                      {item.value}
                    </span>
                  </motion.div>

                  {/* Bottom Label */}
                  <span className="mt-2 text-[10px] font-mono tracking-wider font-semibold text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors text-center">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </StatCard>
  );
}
