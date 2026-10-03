"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StatCard } from "./StatCard";
import type { InsightHistoryPoint } from "@/app/lib/dashboard-mock";

interface InsightsSparklineProps {
  total: number;
  delta: string;
  deltaValue: number;
  period: string;
  history: InsightHistoryPoint[];
  title?: string;
}

export function InsightsSparkline({
  total,
  delta,
  deltaValue,
  period,
  history,
  title = "Insights Generated",
}: InsightsSparklineProps) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);

  // Sparkline coordinates in SVG space 300x100
  const width = 300;
  const height = 90;
  const padding = 12;

  const values = history.map((h) => h.count);
  const maxVal = Math.max(...values, 1);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;

  const points = history.map((item, idx) => {
    const x = padding + (idx / (history.length - 1 || 1)) * (width - padding * 2);
    const y = height - padding - ((item.count - minVal) / range) * (height - padding * 2);
    return { x, y, ...item };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? width} ${height} L ${points[0]?.x ?? 0} ${height} Z`;

  return (
    <StatCard
      title={title}
      value={total}
      delta={delta}
      deltaValue={deltaValue}
      period={period}
    >
      <div
        role="region"
        aria-label={`${title} 30-day trend: ${history.map((h) => `${h.date}: ${h.count}`).join(", ")}`}
        className="w-full flex flex-col justify-between h-full pt-1"
      >
        <div className="relative w-full h-[110px] flex items-center">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id="insightsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Area Fill */}
            <motion.path
              d={areaPath}
              fill="url(#insightsGradient)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
            />

            {/* Stroke Line */}
            <motion.path
              d={linePath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />

            {/* Interactive Data Points */}
            {points.map((p, i) => {
              const isHovered = hoveredIdx === i;
              return (
                <g
                  key={i}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="cursor-pointer"
                >
                  <circle cx={p.x} cy={p.y} r="14" fill="transparent" />
                  <motion.circle
                    cx={p.x}
                    cy={p.y}
                    r={isHovered ? 5 : 3}
                    fill={isHovered ? "var(--accent)" : "#0D0E12"}
                    stroke="var(--accent)"
                    strokeWidth={isHovered ? "2.5" : "2"}
                    animate={{ scale: isHovered ? 1.3 : 1 }}
                    transition={{ type: "spring", stiffness: 350, damping: 20 }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Tooltip on hover */}
          <AnimatePresence>
            {hoveredIdx !== null && points[hoveredIdx] && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.12 }}
                style={{
                  left: `${(points[hoveredIdx].x / width) * 100}%`,
                  top: `${(points[hoveredIdx].y / height) * 100}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-10 bg-black text-white px-2 py-0.5 text-xs font-mono font-bold whitespace-nowrap border border-white/20 rounded shadow z-30 pointer-events-none"
              >
                {points[hoveredIdx].date}: {points[hoveredIdx].count} insights
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* X-axis labels */}
        <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)] px-1 pt-1 border-t border-white/5">
          <span>{history[0]?.date ?? "30d ago"}</span>
          <span className="uppercase tracking-widest text-[9px] font-bold text-[var(--text-secondary)]">
            30-Day Activity Curve
          </span>
          <span>{history[history.length - 1]?.date ?? "Today"}</span>
        </div>
      </div>
    </StatCard>
  );
}
