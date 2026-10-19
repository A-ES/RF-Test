"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Send,
  CreditCard,
  Truck,
  Package,
  FileText,
  User,
  Bot,
  Search,
  ChevronDown,
  ChevronUp,
  Filter,
  Check,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

export interface UnifiedTimelineEntry {
  id: string;
  source: "ORDER_EVENT" | "NOTIFICATION_LOG" | "PAYMENT";
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  title: string;
  description?: string;
  beforeValue?: string | null;
  afterValue?: string | null;
  statusBadge?: string;
  payload?: Record<string, unknown>;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function formatTitle(title: string): string {
  if (!title) return "Activity Event";
  // Clean up any remaining raw snake_case templates
  return title
    .replace(/order_delivered/gi, "Order Delivered")
    .replace(/order_dispatched/gi, "Order Dispatched & Tracking Shared")
    .replace(/payment_received/gi, "Payment Receipt Confirmed")
    .replace(/order_approved/gi, "Order Approved & Confirmed")
    .replace(/order_created/gi, "Order Draft Created")
    .replace(/invoice_issued/gi, "Tax Invoice Generated")
    .replace(/packing_started/gi, "Order Packing Started")
    .replace(/_/g, " ");
}

export function OrderTimeline({
  orderId,
  initialData,
  compact = false,
  limit,
}: {
  orderId: string;
  initialData?: UnifiedTimelineEntry[];
  compact?: boolean;
  limit?: number;
}) {
  const [filter, setFilter] = useState<"all" | "ORDER_EVENT" | "NOTIFICATION_LOG" | "PAYMENT">("all");
  const [search, setSearch] = useState("");
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Set<string>>(new Set());

  const { data, isLoading, mutate } = useSWR<{ timeline: UnifiedTimelineEntry[] }>(
    `/api/orders/${orderId}/timeline`,
    fetcher,
    {
      fallbackData: initialData ? { timeline: initialData } : undefined,
      refreshInterval: 10000,
    },
  );

  const rawTimeline = data?.timeline || [];

  const filteredTimeline = useMemo(() => {
    let items = rawTimeline;
    if (filter !== "all") {
      items = items.filter((item) => item.source === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.title?.toLowerCase().includes(q) ||
          item.action?.toLowerCase().includes(q) ||
          item.actorName?.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.beforeValue?.toLowerCase().includes(q) ||
          item.afterValue?.toLowerCase().includes(q),
      );
    }
    if (limit && limit > 0) {
      items = items.slice(0, limit);
    }
    return items;
  }, [rawTimeline, filter, search, limit]);

  const counts = useMemo(() => {
    return {
      all: rawTimeline.length,
      ORDER_EVENT: rawTimeline.filter((t) => t.source === "ORDER_EVENT").length,
      NOTIFICATION_LOG: rawTimeline.filter((t) => t.source === "NOTIFICATION_LOG").length,
      PAYMENT: rawTimeline.filter((t) => t.source === "PAYMENT").length,
    };
  }, [rawTimeline]);

  function togglePayload(id: string) {
    setExpandedPayloadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getIcon(source: string, action: string) {
    if (source === "PAYMENT") return CreditCard;
    if (source === "NOTIFICATION_LOG") return Send;
    if (action.includes("DELIVER")) return CheckCircle2;
    if (action.includes("DISPATCH")) return Truck;
    if (action.includes("PACKING")) return Package;
    if (action.includes("APPROVED")) return ShieldCheck;
    if (action.includes("CANCEL") || action.includes("REJECT")) return AlertTriangle;
    if (action.includes("INVOICE")) return FileText;
    return Clock;
  }

  function getSourceConfig(source: string) {
    switch (source) {
      case "ORDER_EVENT":
        return {
          label: "Order Milestone",
          badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20",
          iconColor: "text-blue-400 group-hover:text-blue-300",
          bulletRing: "group-hover:border-blue-500 group-hover:shadow-[0_0_12px_rgba(59,130,246,0.3)]",
        };
      case "NOTIFICATION_LOG":
        return {
          label: "WhatsApp Log",
          badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/20",
          iconColor: "text-purple-400 group-hover:text-purple-300",
          bulletRing: "group-hover:border-purple-500 group-hover:shadow-[0_0_12px_rgba(168,85,247,0.3)]",
        };
      case "PAYMENT":
        return {
          label: "Payment",
          badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
          iconColor: "text-emerald-400 group-hover:text-emerald-300",
          bulletRing: "group-hover:border-emerald-500 group-hover:shadow-[0_0_12px_rgba(16,185,129,0.3)]",
        };
      default:
        return {
          label: "Audit Entry",
          badgeClass: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
          iconColor: "text-zinc-400 group-hover:text-zinc-300",
          bulletRing: "group-hover:border-zinc-500",
        };
    }
  }

  if (isLoading && rawTimeline.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-[var(--text-muted)] font-mono animate-pulse flex items-center justify-center gap-2">
        <RefreshCw className="size-4 animate-spin text-[var(--accent)]" />
        <span>Loading unified lifecycle events...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Filter and Search Bar (only if not compact/limited) */}
      {!compact && !limit && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
          {/* Source Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: "all", label: "All Activity", count: counts.all },
              { id: "ORDER_EVENT", label: "Milestones", count: counts.ORDER_EVENT },
              { id: "NOTIFICATION_LOG", label: "WhatsApp Logs", count: counts.NOTIFICATION_LOG },
              { id: "PAYMENT", label: "Payments", count: counts.PAYMENT },
            ].map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id as typeof filter)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5",
                    active
                      ? "bg-[var(--surface-card)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]",
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                      active
                        ? "bg-zinc-800 text-zinc-200"
                        : "bg-zinc-900/50 text-zinc-500",
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search audit trail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
            />
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredTimeline.length === 0 ? (
        <div className="p-8 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-xl space-y-1">
          <Clock className="size-6 text-zinc-600 mx-auto mb-2" />
          <p className="font-semibold text-[var(--text-primary)]">No events match your criteria</p>
          <p className="text-[11px]">
            {search ? "Try clearing your search query." : "Recorded timeline events will appear here."}
          </p>
        </div>
      ) : (
        /* Timeline Container with strictly aligned connector line */
        <div className="relative pl-7 space-y-4 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-[var(--border-subtle)]">
          {filteredTimeline.map((item) => {
            const Icon = getIcon(item.source, item.action);
            const cfg = getSourceConfig(item.source);

            const dateObj = new Date(item.timestamp);
            const formattedDate = dateObj.toLocaleDateString("en-IN", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const formattedTime = dateObj.toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            });

            const isExpanded = expandedPayloadIds.has(item.id);
            const hasPayload =
              item.payload &&
              Object.keys(item.payload).filter((k) => item.payload?.[k] !== undefined).length > 0;

            const isStateTransition =
              item.source === "ORDER_EVENT" &&
              Boolean(item.beforeValue || item.afterValue);

            const isNotification = item.source === "NOTIFICATION_LOG";

            return (
              <div key={item.id} className="relative group">
                {/* Timeline Bullet Icon aligned exactly on connector line */}
                <div
                  className={cn(
                    "absolute -left-7 top-1 size-6 rounded-full bg-[var(--surface-elevated)] border-2 border-[var(--border-subtle)] flex items-center justify-center transition-all duration-200 z-10 shadow-xs",
                    cfg.bulletRing,
                  )}
                >
                  <Icon className={cn("size-3 transition-colors", cfg.iconColor)} />
                </div>

                {/* Event Card */}
                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]/30 transition-all space-y-2.5">
                  {/* Row 1: Title + Badge + Timestamp */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-[var(--text-primary)]">
                        {formatTitle(item.title)}
                      </span>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold border",
                          cfg.badgeClass,
                        )}
                      >
                        {cfg.label}
                      </span>
                    </div>

                    <div className="font-mono text-[10px] text-[var(--text-muted)] shrink-0 flex items-center gap-1">
                      <span>{formattedDate}</span>
                      <span>·</span>
                      <span className="text-[var(--text-secondary)]">{formattedTime}</span>
                    </div>
                  </div>

                  {/* Row 2: Actor Details */}
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                    {item.actorRole === "NOTIFICATION" || item.actorName.includes("Gateway") ? (
                      <Bot className="size-3 text-purple-400" />
                    ) : (
                      <User className="size-3 text-blue-400" />
                    )}
                    <span>Actor:</span>
                    <span className="font-medium text-[var(--text-secondary)]">
                      {item.actorName}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      ({item.actorRole})
                    </span>
                  </div>

                  {/* Row 3: State Transition (for Order Events) OR Delivery Status (for Notifications) */}
                  {isStateTransition && (
                    <div className="flex items-center gap-2 text-xs font-mono bg-zinc-900/60 p-2 rounded-lg border border-zinc-800">
                      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                        State Transition:
                      </span>
                      {item.beforeValue && (
                        <>
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-bold">
                            {item.beforeValue}
                          </span>
                          <ArrowRight className="size-3 text-zinc-500" />
                        </>
                      )}
                      {item.afterValue && (
                        <span className="px-2 py-0.5 rounded bg-blue-950/80 text-blue-400 border border-blue-500/30 text-[10px] font-bold shadow-xs">
                          {item.afterValue}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Notification delivery confirmation pill */}
                  {isNotification && (
                    <div className="flex items-center gap-2 text-xs font-mono bg-purple-950/20 p-2 rounded-lg border border-purple-500/20">
                      <Check className="size-3 text-purple-400" />
                      <span className="text-[10px] text-purple-300 font-medium">
                        Dispatch Status:
                      </span>
                      <span className="px-2 py-0.5 rounded bg-purple-900/40 text-purple-200 border border-purple-500/30 text-[10px] font-bold">
                        {item.statusBadge || "SENT"}
                      </span>
                    </div>
                  )}

                  {/* Row 4: Description if present */}
                  {item.description && (
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      {item.description}
                    </p>
                  )}

                  {/* Carrier / Tracking metadata if present */}
                  {Boolean(item.payload && (item.payload.carrier || item.payload.trackingRef)) && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-purple-300 bg-purple-950/20 p-2 rounded-lg border border-purple-500/20">
                      {item.payload?.carrier ? (
                        <span className="flex items-center gap-1">
                          <Truck className="size-3" /> Carrier:{" "}
                          <strong>{String(item.payload.carrier)}</strong>
                        </span>
                      ) : null}
                      {item.payload?.trackingRef ? (
                        <span>
                          Tracking Ref:{" "}
                          <strong className="text-white">{String(item.payload.trackingRef)}</strong>
                        </span>
                      ) : null}
                    </div>
                  )}

                  {/* Expandable Audit Trail Details */}
                  {hasPayload && !compact && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => togglePayload(item.id)}
                        className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="size-3" /> Hide technical audit metadata
                          </>
                        ) : (
                          <>
                            <ChevronDown className="size-3" /> View audit payload
                          </>
                        )}
                      </button>

                      {isExpanded && (
                        <pre className="mt-2 p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-mono text-zinc-400 overflow-x-auto max-h-48 leading-relaxed">
                          {JSON.stringify(item.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
