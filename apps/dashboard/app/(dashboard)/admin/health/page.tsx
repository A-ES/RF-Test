"use client";

import React from "react";
import useSWR from "swr";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Clock,
  Send,
  RefreshCw,
  Server,
  Layers,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function AdminHealthPage() {
  const { data, error, isLoading, mutate } = useSWR("/api/admin/health", fetcher, {
    refreshInterval: 10000,
  });

  const isHealthy = data?.status === "healthy";
  const isDegraded = data?.status === "degraded";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
            <Activity className="size-3.5 text-emerald-400" />
            <span>Diagnostics & Ops</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            System & Infrastructure Health
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Real-time monitoring of webhook pipelines, queue lag, notifications gateway, and ERP sync status.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void mutate()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-[var(--surface-card)] text-white text-xs font-semibold hover:bg-white/[0.05] transition-colors cursor-pointer"
        >
          <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
          <span>Refresh</span>
        </button>
      </div>

      {isLoading && !data ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)] font-mono animate-pulse">
          Probing system diagnostics...
        </div>
      ) : (
        <>
          {/* Status Banner */}
          <div
            className={cn(
              "p-5 rounded-2xl border flex items-center justify-between shadow-lg",
              isHealthy
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : isDegraded
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                  : "bg-rose-500/10 border-rose-500/20 text-rose-400",
            )}
          >
            <div className="flex items-center gap-3">
              {isHealthy ? (
                <CheckCircle2 className="size-6 text-emerald-400" />
              ) : isDegraded ? (
                <AlertTriangle className="size-6 text-amber-400" />
              ) : (
                <XCircle className="size-6 text-rose-400" />
              )}
              <div>
                <h2 className="font-bold text-sm text-white capitalize">
                  System Status: {data?.status ?? "Unknown"}
                </h2>
                <p className="text-xs text-white/70">
                  {isHealthy
                    ? "All core pipelines, webhook gateways, and database Seams operational."
                    : isDegraded
                      ? "Degraded performance or failed retries detected in background workers."
                      : "Critical failure in one or more infrastructure dependencies."}
                </p>
              </div>
            </div>

            <span className="text-xs font-mono px-3 py-1 rounded-lg bg-black/30 border border-white/10 text-white">
              Uptime: {Math.floor((data?.uptimeSeconds ?? 0) / 60)}m
            </span>
          </div>

          {/* Diagnostic Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Database Latency */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Database Connection</span>
                <Database className="size-4 text-blue-400" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold font-mono text-white">
                  {data?.database?.latencyMs ?? 0} ms
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {data?.database?.status ?? "OK"}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">PostgreSQL query probe round-trip</p>
            </div>

            {/* Queue Lag */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Approval Queue Lag</span>
                <Layers className="size-4 text-purple-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {data?.metrics?.queueLag ?? 0} orders
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">In-flight orders awaiting review</p>
            </div>

            {/* Last Webhook */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Last Inbound Webhook</span>
                <Clock className="size-4 text-amber-400" />
              </div>
              <div className="text-xs font-bold font-mono text-white truncate">
                {data?.metrics?.lastWebhook ? new Date(data.metrics.lastWebhook).toLocaleTimeString() : "None"}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] truncate">
                {data?.metrics?.lastWebhook ? new Date(data.metrics.lastWebhook).toLocaleDateString() : "No recent events"}
              </p>
            </div>

            {/* Failed Notifications */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Failed Notifications</span>
                <Send className="size-4 text-rose-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {data?.metrics?.failedNotifications ?? 0}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">WhatsApp / Email delivery drops</p>
            </div>
          </div>

          {/* ERP Integration Seam Status */}
          <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
              <Server className="size-4 text-blue-400" />
              ERP Seam & Inventory Synchronization
            </h3>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 text-xs">
              <div>
                <span className="font-bold text-white block">ERP Synchronization Failures</span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Fulfillment dispatch transactions where external ERP sync failed (local movements preserved).
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-base font-bold font-mono text-white">
                  {data?.metrics?.erpFailures ?? 0} failures
                </span>
                <span
                  className={cn(
                    "text-[10px] font-mono px-2 py-0.5 rounded font-bold border",
                    (data?.metrics?.erpFailures ?? 0) === 0
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20",
                  )}
                >
                  {(data?.metrics?.erpFailures ?? 0) === 0 ? "HEALTHY" : "SYNC_FAILED"}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
