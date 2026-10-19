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
  DollarSign,
  TrendingUp,
  Download,
  Package,
  Layers,
  Users,
  Calendar,
  ExternalLink,
  AlertCircle,
  FileText,
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
      {/* Header with Date Filter and CSV Export Buttons */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
            <ShoppingCart className="size-3.5 text-blue-400" />
            <span>Analytics & Performance</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Orders Overview & Revenue Dashboard
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Real-time pipeline metrics, approval velocity, fulfillment status, and financial health.
          </p>
        </div>

        {/* Date Filter & Export Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Days Filter Pills */}
          <div className="flex items-center p-1 rounded-xl bg-white/[0.04] border border-white/10 text-xs">
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
                  "px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer",
                  days === p.val
                    ? "bg-red-500 text-white shadow-sm"
                    : "text-[var(--text-muted)] hover:text-white hover:bg-white/[0.05]",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* CSV Export Links */}
          <a
            href="/api/orders/export"
            download
            className="px-3.5 py-1.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <Download className="size-3.5" />
            <span>Export Orders</span>
          </a>

          <a
            href="/api/payments/export"
            download
            className="px-3.5 py-1.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <Download className="size-3.5" />
            <span>Export Payments</span>
          </a>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="p-16 text-center text-xs text-[var(--text-muted)] font-mono animate-pulse">
          Loading orders analytics overview...
        </div>
      ) : (
        <>
          {/* Metric Cards Row 1: Orders & Pipeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* New / Draft Orders */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">New Drafts</span>
                <Clock className="size-4 text-blue-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                {cards?.newOrdersCount ?? 0}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">In-flight draft requests</p>
            </div>

            {/* Awaiting Approval (With Oldest Age) */}
            <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 space-y-2">
              <div className="flex items-center justify-between text-xs text-amber-400">
                <span className="font-semibold">Awaiting Approval</span>
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex items-baseline justify-between">
                <div className="text-2xl font-bold font-mono text-white">
                  {cards?.awaitingApprovalCount ?? 0}
                </div>
                <div className="text-[11px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                  Oldest: {cards?.awaitingApprovalOldestAge ?? "0m"}
                </div>
              </div>
              <p className="text-[11px] text-amber-300/80">Pending admin review gate</p>
            </div>

            {/* Approved Orders */}
            <div className="p-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 space-y-2">
              <div className="flex items-center justify-between text-xs text-emerald-400">
                <span className="font-semibold">Approved Orders</span>
                <CheckCircle2 className="size-4" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                {cards?.approvedCount ?? 0}
              </div>
              <p className="text-[11px] text-emerald-300/80">Confirmed order pipeline</p>
            </div>

            {/* Rejected / Cancelled */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Rejected / Cancelled</span>
                <XCircle className="size-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                {cards?.rejectedCount ?? 0}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">Declined or retracted</p>
            </div>
          </div>

          {/* Metric Cards Row 2: Revenue, Payments & Inventory */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Revenue */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Pipeline Revenue</span>
                <TrendingUp className="size-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {formatMoney(cards?.revenueMinor)}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                AOV: <span className="font-mono text-white">{formatMoney(cards?.aovMinor)}</span>
              </p>
            </div>

            {/* Payment Status Breakdown */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Payments Received</span>
                <CreditCard className="size-4 text-purple-400" />
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {formatMoney(cards?.payments?.paidMinor)}
              </div>
              <div className="flex gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                <span>Partial: {formatMoney(cards?.payments?.partialMinor)}</span>
              </div>
            </div>

            {/* Overdue Payments */}
            <div className="p-5 rounded-2xl border border-rose-500/20 bg-rose-500/5 space-y-2">
              <div className="flex items-center justify-between text-xs text-rose-400">
                <span className="font-semibold">Overdue Invoices</span>
                <AlertCircle className="size-4" />
              </div>
              <div className="text-xl font-bold font-mono text-rose-300">
                {formatMoney(cards?.payments?.overdueMinor)}
              </div>
              <p className="text-[11px] text-rose-400/80">Invoices past due date</p>
            </div>

            {/* Low Stock Alerts */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold">Low Stock SKUs</span>
                <Package className="size-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-amber-400">
                {cards?.lowStockCount ?? 0}
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">Available &le; Reorder Level</p>
            </div>
          </div>

          {/* Fulfillment Pipeline Banner */}
          <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                <Truck className="size-4 text-blue-400" />
                Fulfillment Pipeline Board Status
              </h3>
              <Link
                href="/orders/fulfillment"
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
              >
                Open Kanban Board &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-[10px] uppercase font-mono text-amber-400 block">Pending</span>
                <span className="text-xl font-bold font-mono text-white">
                  {cards?.fulfillmentCounts?.pending ?? 0}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <span className="text-[10px] uppercase font-mono text-blue-400 block">Packing</span>
                <span className="text-xl font-bold font-mono text-white">
                  {cards?.fulfillmentCounts?.packing ?? 0}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                <span className="text-[10px] uppercase font-mono text-purple-400 block">Dispatched</span>
                <span className="text-xl font-bold font-mono text-white">
                  {cards?.fulfillmentCounts?.dispatched ?? 0}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-[10px] uppercase font-mono text-emerald-400 block">Delivered</span>
                <span className="text-xl font-bold font-mono text-white">
                  {cards?.fulfillmentCounts?.delivered ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* Charts Row: Funnel & Rankings */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Conversion & Fulfillment Funnel */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Conversion Funnel
              </h3>
              <div className="space-y-3 text-xs">
                {[
                  { label: "1. Drafted Orders", val: charts?.funnel?.drafted ?? 0, color: "bg-blue-500" },
                  { label: "2. Approved", val: charts?.funnel?.approved ?? 0, color: "bg-purple-500" },
                  { label: "3. Invoiced", val: charts?.funnel?.invoiced ?? 0, color: "bg-amber-500" },
                  { label: "4. Paid", val: charts?.funnel?.paid ?? 0, color: "bg-emerald-500" },
                  { label: "5. Delivered", val: charts?.funnel?.delivered ?? 0, color: "bg-emerald-400" },
                ].map((step) => {
                  const max = Math.max(1, charts?.funnel?.drafted ?? 1);
                  const pct = Math.round((step.val / max) * 100);
                  return (
                    <div key={step.label} className="space-y-1">
                      <div className="flex justify-between font-mono">
                        <span className="text-[var(--text-secondary)]">{step.label}</span>
                        <span className="font-bold text-white">
                          {step.val} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", step.color)}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Products */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Top Products by Revenue
              </h3>
              {(!charts?.topProducts || charts.topProducts.length === 0) ? (
                <p className="text-xs text-[var(--text-muted)] font-mono">No product sales in range.</p>
              ) : (
                <div className="space-y-3 text-xs">
                  {charts.topProducts.map((p: any) => (
                    <div key={p.sku} className="flex items-center justify-between border-b border-white/5 pb-2">
                      <div className="space-y-0.5">
                        <span className="font-bold text-white block">{p.name}</span>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          {p.sku} · {p.quantity} units
                        </span>
                      </div>
                      <span className="font-mono font-bold text-emerald-400">
                        {formatMoney(p.revenueMinor)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Customers */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Top Customers by Spend
              </h3>
              {(!charts?.topCustomers || charts.topCustomers.length === 0) ? (
                <p className="text-xs text-[var(--text-muted)] font-mono">No customer orders in range.</p>
              ) : (
                <div className="space-y-3 text-xs">
                  {charts.topCustomers.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between border-b border-white/5 pb-2">
                      <div className="space-y-0.5">
                        <Link href={`/customers/${c.id}`} className="font-bold text-white hover:text-blue-400 block">
                          {c.name}
                        </Link>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {c.company || "Individual"} · {c.orderCount} orders
                        </span>
                      </div>
                      <span className="font-mono font-bold text-emerald-400">
                        {formatMoney(c.totalSpendMinor)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tables Section: Overdue Invoices & Low Stock Inventory */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Overdue Invoices Table */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                  <FileText className="size-4" />
                  Overdue Invoices
                </h3>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  {tables?.overdueInvoices?.length ?? 0} overdue
                </span>
              </div>
              {(!tables?.overdueInvoices || tables.overdueInvoices.length === 0) ? (
                <p className="text-xs text-[var(--text-muted)] font-mono py-4">
                  No overdue invoices. All accounts current!
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/10 text-[10px] font-mono uppercase text-[var(--text-muted)]">
                      <tr>
                        <th className="pb-2">Invoice</th>
                        <th className="pb-2">Customer</th>
                        <th className="pb-2 text-right">Amount</th>
                        <th className="pb-2 text-right">Overdue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tables.overdueInvoices.map((inv: any) => (
                        <tr key={inv.id} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 font-mono font-bold text-white">
                            <Link href={`/orders/${inv.orderId}`} className="hover:text-red-400">
                              {inv.invoiceNumber}
                            </Link>
                          </td>
                          <td className="py-2.5 text-[var(--text-secondary)]">{inv.customerName}</td>
                          <td className="py-2.5 text-right font-mono font-bold text-white">
                            {formatMoney(inv.totalMinor)}
                          </td>
                          <td className="py-2.5 text-right font-mono font-bold text-rose-400">
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
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <Package className="size-4" />
                  Inventory Stock Status
                </h3>
                <Link href="/inventory" className="text-xs text-blue-400 hover:text-blue-300">
                  Full Inventory &rarr;
                </Link>
              </div>
              {(!tables?.inventory || tables.inventory.length === 0) ? (
                <p className="text-xs text-[var(--text-muted)] font-mono py-4">No inventory data.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/10 text-[10px] font-mono uppercase text-[var(--text-muted)]">
                      <tr>
                        <th className="pb-2">SKU</th>
                        <th className="pb-2">Product</th>
                        <th className="pb-2 text-center">On-Hand</th>
                        <th className="pb-2 text-center">Available</th>
                        <th className="pb-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tables.inventory.map((inv: any) => (
                        <tr key={inv.sku} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 font-mono text-white/90">{inv.sku}</td>
                          <td className="py-2.5 text-[var(--text-secondary)] truncate max-w-[120px]">
                            {inv.name}
                          </td>
                          <td className="py-2.5 text-center font-mono text-white/80">{inv.onHand}</td>
                          <td className="py-2.5 text-center font-mono font-bold text-white">{inv.available}</td>
                          <td className="py-2.5 text-right">
                            {inv.isLowStock ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-mono font-bold">
                                LOW
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-mono font-bold">
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
