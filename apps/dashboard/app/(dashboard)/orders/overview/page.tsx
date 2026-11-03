"use client";

import React, { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  ShoppingCart,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Truck,
  CreditCard,
  TrendingUp,
  Download,
  Package,
  ExternalLink,
  AlertCircle,
  FileText,
  ArrowRight,
  ChevronRight,
  Activity,
  Layers,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function OrdersOverviewPage() {
  const [days, setDays] = useState<number>(30);

  const { data, isLoading } = useSWR(
    `/api/orders/overview?days=${days}`,
    fetcher,
    { refreshInterval: 15000 },
  );

  const cards = data?.cards;
  const charts = data?.charts;
  const tables = data?.tables;

  function formatMoney(minor: number = 0) {
    return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* ─── Page Header ─── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-white/[0.06]">
        <div>
          <p className="dash-eyebrow mb-1">/ orders &amp; pipeline telemetry</p>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Orders Overview &amp; Revenue Analytics
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Real-time pipeline metrics, approval velocity, fulfillment status, and financial health.
          </p>
        </div>

        {/* Date Filter & Export Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Days Filter Segmented Control */}
          <div className="inline-flex items-center p-0.5 rounded-lg bg-[#0D0E12] border border-white/[0.08] text-xs">
            {[
              { label: "7D", val: 7 },
              { label: "30D", val: 30 },
              { label: "90D", val: 90 },
            ].map((p) => (
              <button
                key={p.val}
                type="button"
                onClick={() => setDays(p.val)}
                className={cn(
                  "px-3 py-1.5 rounded-md font-mono text-xs transition-colors cursor-pointer",
                  days === p.val
                    ? "bg-[var(--accent)] text-white font-semibold shadow-xs"
                    : "text-[var(--text-muted)] hover:text-white hover:bg-white/[0.04]",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Export Actions */}
          <a
            href="/api/orders/export"
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#0D0E12] hover:bg-white/[0.04] text-[var(--text-primary)] text-xs font-medium transition-colors"
          >
            <Download className="size-3.5 text-white/50" />
            <span>Export Orders</span>
          </a>

          <a
            href="/api/payments/export"
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-[#0D0E12] hover:bg-white/[0.04] text-[var(--text-primary)] text-xs font-medium transition-colors"
          >
            <Download className="size-3.5 text-white/50" />
            <span>Export Payments</span>
          </a>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="p-20 text-center text-xs text-[var(--text-muted)] font-mono animate-pulse">
          Loading orders analytics overview...
        </div>
      ) : (
        <>
          {/* ─── Metric Group 1: Order Pipeline Velocity ─── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-white/40">
                Pipeline Throughput &amp; Approval Flow
              </span>
              <span className="text-[10px] font-mono text-white/30">Rolling {days}d window</span>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#0D0E12] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] overflow-hidden shadow-xs">
              {/* New / Draft Orders */}
              <div className="p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider">New Drafts</span>
                  <Clock className="size-3.5 text-white/40" />
                </div>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-[var(--text-primary)] tracking-tight">
                  {cards?.newOrdersCount ?? 0}
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">In-flight draft requests</p>
              </div>

              {/* Awaiting Approval */}
              <div className="p-4 sm:p-5 space-y-2 bg-white/[0.01]">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider">Awaiting Approval</span>
                  <AlertTriangle className="size-3.5 text-amber-400/80" />
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-white tracking-tight">
                    {cards?.awaitingApprovalCount ?? 0}
                  </div>
                  {(cards?.awaitingApprovalCount ?? 0) > 0 && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 shrink-0">
                      Oldest: {cards?.awaitingApprovalOldestAge ?? "0m"}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">Pending admin confirmation</p>
              </div>

              {/* Approved Orders */}
              <div className="p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider">Approved Orders</span>
                  <CheckCircle2 className="size-3.5 text-emerald-400/80" />
                </div>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-white tracking-tight">
                  {cards?.approvedCount ?? 0}
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">Confirmed order pipeline</p>
              </div>

              {/* Rejected / Cancelled */}
              <div className="p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider">Rejected / Cancelled</span>
                  <XCircle className="size-3.5 text-white/40" />
                </div>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-[var(--text-primary)] tracking-tight">
                  {cards?.rejectedCount ?? 0}
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">Declined or retracted orders</p>
              </div>
            </div>
          </div>

          {/* ─── Metric Group 2: Revenue, Payments & Inventory Health ─── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-white/40">
                Financial Capital &amp; Inventory Signals
              </span>
              <span className="text-[10px] font-mono text-white/30">Currency: INR</span>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#0D0E12] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] overflow-hidden shadow-xs">
              {/* Pipeline Revenue */}
              <div className="p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider">Pipeline Revenue</span>
                  <TrendingUp className="size-3.5 text-emerald-400" />
                </div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
                  {formatMoney(cards?.revenueMinor)}
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  AOV: <span className="font-mono text-white/80">{formatMoney(cards?.aovMinor)}</span>
                </p>
              </div>

              {/* Payments Received */}
              <div className="p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider">Payments Received</span>
                  <CreditCard className="size-3.5 text-white/40" />
                </div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
                  {formatMoney(cards?.payments?.paidMinor)}
                </div>
                <p className="text-[11px] font-mono text-[var(--text-muted)]">
                  Partial: {formatMoney(cards?.payments?.partialMinor)}
                </p>
              </div>

              {/* Overdue Invoices — Purposeful Red Highlight */}
              <div className="p-4 sm:p-5 space-y-2 bg-[#F24E4B]/[0.02]">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[#F24E4B]">
                    Overdue Invoices
                  </span>
                  <AlertCircle className="size-3.5 text-[#F24E4B]" />
                </div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-[#F24E4B] tracking-tight">
                  {formatMoney(cards?.payments?.overdueMinor)}
                </div>
                <p className="text-[11px] text-white/40">Outstanding past due date</p>
              </div>

              {/* Low Stock Alerts */}
              <div className="p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider">Low Stock SKUs</span>
                  <Package className="size-3.5 text-amber-400/80" />
                </div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
                  {cards?.lowStockCount ?? 0}
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">Available &le; reorder level</p>
              </div>
            </div>
          </div>

          {/* ─── Fulfillment Pipeline Board Status ─── */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0D0E12] p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="size-4 text-white/50" />
                <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Fulfillment Velocity &amp; Pipeline Status
                </h3>
              </div>
              <Link
                href="/orders/fulfillment"
                className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors font-medium"
              >
                <span>Open Kanban Board</span>
                <ChevronRight className="size-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Stage 1: Pending */}
              <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase font-mono text-white/50">
                  <span className="size-1.5 rounded-full bg-amber-400" />
                  <span>Pending</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {cards?.fulfillmentCounts?.pending ?? 0}
                </div>
              </div>

              {/* Stage 2: Packing */}
              <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase font-mono text-white/50">
                  <span className="size-1.5 rounded-full bg-blue-400" />
                  <span>Packing</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {cards?.fulfillmentCounts?.packing ?? 0}
                </div>
              </div>

              {/* Stage 3: Dispatched */}
              <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase font-mono text-white/50">
                  <span className="size-1.5 rounded-full bg-purple-400" />
                  <span>Dispatched</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {cards?.fulfillmentCounts?.dispatched ?? 0}
                </div>
              </div>

              {/* Stage 4: Delivered */}
              <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase font-mono text-white/50">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span>Delivered</span>
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {cards?.fulfillmentCounts?.delivered ?? 0}
                </div>
              </div>
            </div>
          </div>

          {/* ─── Charts Row: Funnel & Rankings ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Conversion & Fulfillment Funnel */}
            <div className="p-5 rounded-xl border border-white/[0.08] bg-[#0D0E12] space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Conversion Funnel
                </h3>
                <span className="text-[10px] font-mono text-white/40">Step drop-off</span>
              </div>

              <div className="space-y-3.5 text-xs pt-1">
                {[
                  { label: "1. Drafted Orders", val: charts?.funnel?.drafted ?? 0 },
                  { label: "2. Approved", val: charts?.funnel?.approved ?? 0 },
                  { label: "3. Invoiced", val: charts?.funnel?.invoiced ?? 0 },
                  { label: "4. Paid", val: charts?.funnel?.paid ?? 0 },
                  { label: "5. Delivered", val: charts?.funnel?.delivered ?? 0 },
                ].map((step, idx) => {
                  const max = Math.max(1, charts?.funnel?.drafted ?? 1);
                  const pct = Math.round((step.val / max) * 100);

                  return (
                    <div key={step.label} className="space-y-1.5">
                      <div className="flex justify-between font-mono text-[11px]">
                        <span className="text-white/70">{step.label}</span>
                        <span className="font-semibold text-white">
                          {step.val} <span className="text-white/40 font-normal">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-white/80 transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.max(step.val > 0 ? 3 : 0, pct))}%`,
                            opacity: 0.5 + (0.5 * (5 - idx)) / 5,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Products */}
            <div className="p-5 rounded-xl border border-white/[0.08] bg-[#0D0E12] space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Top Products by Revenue
                </h3>
                <span className="text-[10px] font-mono text-white/40">Ranked</span>
              </div>

              {!charts?.topProducts || charts.topProducts.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] font-mono py-8 text-center">
                  No product sales in selected range.
                </p>
              ) : (
                <div className="space-y-2.5 text-xs">
                  {charts.topProducts.map((p: any, idx: number) => (
                    <div
                      key={p.sku}
                      className="flex items-center justify-between border-b border-white/[0.04] pb-2.5 last:border-b-0 last:pb-0"
                    >
                      <div className="space-y-0.5 min-w-0 pr-2">
                        <span className="font-medium text-white block truncate">
                          <span className="text-[10px] font-mono text-white/40 mr-1.5">#{idx + 1}</span>
                          {p.name}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--text-muted)] block truncate">
                          {p.sku} &bull; {p.quantity} units
                        </span>
                      </div>
                      <span className="font-mono font-medium text-white shrink-0 text-right">
                        {formatMoney(p.revenueMinor)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Customers */}
            <div className="p-5 rounded-xl border border-white/[0.08] bg-[#0D0E12] space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Top Accounts by Spend
                </h3>
                <span className="text-[10px] font-mono text-white/40">Wholesale</span>
              </div>

              {!charts?.topCustomers || charts.topCustomers.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] font-mono py-8 text-center">
                  No customer orders in selected range.
                </p>
              ) : (
                <div className="space-y-2.5 text-xs">
                  {charts.topCustomers.map((c: any, idx: number) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between border-b border-white/[0.04] pb-2.5 last:border-b-0 last:pb-0"
                    >
                      <div className="space-y-0.5 min-w-0 pr-2">
                        <Link
                          href={`/customers/${c.id}`}
                          className="font-medium text-white hover:text-[var(--accent)] transition-colors block truncate"
                        >
                          <span className="text-[10px] font-mono text-white/40 mr-1.5">#{idx + 1}</span>
                          {c.name}
                        </Link>
                        <span className="text-[10px] font-mono text-[var(--text-muted)] block truncate">
                          {c.company || "Direct Account"} &bull; {c.orderCount} orders
                        </span>
                      </div>
                      <span className="font-mono font-medium text-white shrink-0 text-right">
                        {formatMoney(c.totalSpendMinor)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── Tables Section: Overdue Invoices & Low Stock Inventory ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Overdue Invoices Table */}
            <div className="p-5 rounded-xl border border-white/[0.08] bg-[#0D0E12] space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-[#F24E4B]" />
                  <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-white">
                    Overdue Invoices
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
                  {tables?.overdueInvoices?.length ?? 0} requiring action
                </span>
              </div>

              {!tables?.overdueInvoices || tables.overdueInvoices.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)] font-mono">
                  No overdue invoices on record. All wholesale accounts are current.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.06] text-[10px] font-mono uppercase text-white/40">
                      <tr>
                        <th className="pb-2.5 font-normal">Invoice</th>
                        <th className="pb-2.5 font-normal">Customer</th>
                        <th className="pb-2.5 text-right font-normal">Amount</th>
                        <th className="pb-2.5 text-right font-normal">Aging</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {tables.overdueInvoices.map((inv: any) => (
                        <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 font-mono text-white">
                            <Link
                              href={`/orders/${inv.orderId}`}
                              className="hover:text-[var(--accent)] transition-colors underline-offset-2 hover:underline"
                            >
                              {inv.invoiceNumber}
                            </Link>
                          </td>
                          <td className="py-2.5 text-white/70 truncate max-w-[140px]">{inv.customerName}</td>
                          <td className="py-2.5 text-right font-mono font-medium text-white">
                            {formatMoney(inv.totalMinor)}
                          </td>
                          <td className="py-2.5 text-right font-mono font-semibold text-[#F24E4B]">
                            +{inv.daysOverdue}d
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Inventory Levels Table */}
            <div className="p-5 rounded-xl border border-white/[0.08] bg-[#0D0E12] space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="size-4 text-white/50" />
                  <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-white">
                    Inventory Stock Depletion Status
                  </h3>
                </div>
                <Link
                  href="/inventory"
                  className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors font-medium"
                >
                  <span>Full Inventory</span>
                  <ChevronRight className="size-3.5" />
                </Link>
              </div>

              {!tables?.inventory || tables.inventory.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)] font-mono">
                  No inventory tracking data available.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.06] text-[10px] font-mono uppercase text-white/40">
                      <tr>
                        <th className="pb-2.5 font-normal">SKU</th>
                        <th className="pb-2.5 font-normal">Product</th>
                        <th className="pb-2.5 text-center font-normal">On-Hand</th>
                        <th className="pb-2.5 text-center font-normal">Available</th>
                        <th className="pb-2.5 text-right font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {tables.inventory.map((inv: any) => (
                        <tr key={inv.sku} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 font-mono text-white/80">{inv.sku}</td>
                          <td className="py-2.5 text-white/70 truncate max-w-[130px]">
                            {inv.name}
                          </td>
                          <td className="py-2.5 text-center font-mono text-white/60">{inv.onHand}</td>
                          <td className="py-2.5 text-center font-mono font-medium text-white">{inv.available}</td>
                          <td className="py-2.5 text-right">
                            {inv.isLowStock ? (
                              <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-mono font-semibold">
                                LOW
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-white/[0.04] text-white/60 border border-white/10 text-[10px] font-mono">
                                OK
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
