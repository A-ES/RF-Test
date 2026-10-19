"use client";

import React, { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  ShoppingCart,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ChevronRight,
  Filter,
  RefreshCw,
  FileText,
  User,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

interface OrderLineSummary {
  id: string;
  sku: string;
  rawText?: string;
  qty: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  product?: {
    id: string;
    sku: string;
    name: string;
    unit: string;
  } | null;
}

interface OrderItem {
  id: string;
  draftNumber: string;
  orderNumber: string | null;
  status: string;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  deliveryDate?: string | null;
  deliveryAddress?: string | null;
  instructions?: string | null;
  flagsJson?: string;
  version: number;
  createdAt: string;
  customer?: {
    id: string;
    name: string;
    company?: string | null;
    whatsapp?: string | null;
    phone?: string | null;
  } | null;
  lines?: OrderLineSummary[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState<"all" | "new" | "awaiting_approval" | "approved" | "rejected">("all");
  const [search, setSearch] = useState("");

  const queryParams = new URLSearchParams();
  if (activeTab !== "all") {
    queryParams.set("tab", activeTab);
  }
  if (search.trim()) {
    queryParams.set("search", search.trim());
  }

  const { data, error, isLoading, mutate } = useSWR<{
    orders: OrderItem[];
    nextCursor?: string | null;
    totalCount?: number;
  }>(`/api/orders?${queryParams.toString()}`, fetcher, {
    refreshInterval: 10000,
  });

  const orders = data?.orders || [];

  function formatMoney(paise: number, currency = "INR") {
    const rupees = (paise || 0) / 100;
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(rupees);
  }

  function parseFlags(flagsJson?: string): string[] {
    if (!flagsJson) return [];
    try {
      return JSON.parse(flagsJson);
    } catch {
      return [];
    }
  }

  function getStatusBadge(status: string, flags: string[]) {
    switch (status) {
      case "APPROVED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="size-3.5" />
            Approved
          </span>
        );
      case "NEEDS_REVIEW":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="size-3.5" />
            Awaiting Approval
          </span>
        );
      case "DRAFT":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Clock className="size-3.5" />
            New Draft
          </span>
        );
      case "REJECTED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="size-3.5" />
            Rejected
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-300 border border-zinc-500/20">
            {status}
          </span>
        );
    }
  }

  return (
    <div className="flex-1 space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[rgba(242,78,75,0.12)] text-[var(--accent)] border border-[rgba(242,78,75,0.2)]">
              <ShoppingCart className="size-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              Orders & Confirmations
            </h1>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Review WhatsApp order drafts, pricing, inventory flags, and client confirmation gates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/orders/overview"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-colors"
          >
            <TrendingUp className="size-3.5" />
            <span>Orders Overview</span>
          </Link>
          <a
            href="/api/orders/export"
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-white border border-[var(--border-subtle)] transition-colors"
          >
            <FileText className="size-3.5" />
            <span>Export CSV</span>
          </a>
          <button
            type="button"
            onClick={() => void mutate()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--border-subtle)]">
        <nav className="flex space-x-6">
          {[
            { id: "all", label: "All Orders" },
            { id: "new", label: "New", countTag: "DRAFT" },
            { id: "awaiting_approval", label: "Awaiting approval", countTag: "NEEDS_REVIEW" },
            { id: "approved", label: "Approved", countTag: "APPROVED" },
            { id: "rejected", label: "Rejected", countTag: "REJECTED" },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={cn(
                  "py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 outline-none",
                  isActive
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-subtle)]"
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Search & Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order #, draft #, customer name, company..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
          />
        </div>
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* Orders List */}
      {isLoading && orders.length === 0 ? (
        <div className="py-20 text-center text-sm text-[var(--text-muted)]">
          <RefreshCw className="size-6 animate-spin mx-auto mb-2 opacity-50" />
          Loading orders...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-12 text-center">
          <div className="p-3 w-12 h-12 mx-auto rounded-full bg-[rgba(242,78,75,0.08)] text-[var(--accent)] flex items-center justify-center mb-3">
            <ShoppingCart className="size-6" />
          </div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">No orders found</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)] max-w-sm mx-auto">
            {search
              ? "No orders match your search query."
              : activeTab === "awaiting_approval"
              ? "No drafts are currently waiting for approval."
              : "Inbound WhatsApp order requests will appear here automatically."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const flags = parseFlags(order.flagsJson);
            const lineSummary =
              order.lines && order.lines.length > 0
                ? order.lines
                    .map((l) => `${l.qty}x ${l.product?.name || l.sku}`)
                    .slice(0, 3)
                    .join(", ") + (order.lines.length > 3 ? ` +${order.lines.length - 3} more` : "")
                : "No line items";

            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block group rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover)] hover:border-[var(--accent)]/40 transition-all p-5 shadow-sm"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-base font-bold text-[var(--text-primary)]">
                        {order.orderNumber ? order.orderNumber : order.draftNumber}
                      </span>
                      {order.orderNumber && (
                        <span className="font-mono text-xs text-[var(--text-muted)] bg-[var(--surface-card)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
                          Draft: {order.draftNumber}
                        </span>
                      )}
                      {getStatusBadge(order.status, flags)}
                      {flags.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {flags.map((flag, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20"
                            >
                              {flag.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1 font-medium text-[var(--text-primary)]">
                        <User className="size-3.5 text-[var(--text-muted)]" />
                        {order.customer?.name || "Customer"}
                        {order.customer?.company ? ` (${order.customer.company})` : ""}
                      </span>
                      {order.customer?.whatsapp && (
                        <span className="text-[var(--text-muted)]">
                          WA: {order.customer.whatsapp}
                        </span>
                      )}
                      <span>•</span>
                      <span>v{order.version}</span>
                      <span>•</span>
                      <span>
                        {new Date(order.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--text-muted)] truncate max-w-2xl">
                      {lineSummary}
                    </p>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 pt-3 md:pt-0 border-[var(--border-subtle)]">
                    <div className="text-left md:text-right">
                      <div className="text-base font-bold text-[var(--text-primary)]">
                        {formatMoney(order.totalMinor, order.currency)}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {order.lines?.length ?? 0} item{(order.lines?.length ?? 0) === 1 ? "" : "s"}
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-[var(--surface-card)] group-hover:bg-[var(--accent)] group-hover:text-white text-[var(--text-muted)] transition-colors">
                      <ChevronRight className="size-4" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
