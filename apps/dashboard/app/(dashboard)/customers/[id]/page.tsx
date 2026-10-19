"use client";

import React, { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Users,
  Building2,
  Phone,
  Mail,
  MessageCircle,
  ShoppingCart,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  FileText,
  DollarSign,
  Package,
  Calendar,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

interface OrderLine {
  id: string;
  sku: string;
  rawText: string;
  qty: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

interface CustomerOrderDetail {
  id: string;
  orderNumber?: string | null;
  draftNumber: string;
  status: string;
  paymentStatus: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  lines?: OrderLine[];
}

interface CustomerDetail {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  status: string;
  taxId?: string | null;
  paymentTermsDays?: number | null;
  internalNotes?: string | null;
  createdAt: string;
  totalSpendMinor: number;
  orderCount: number;
  orders: CustomerOrderDetail[];
  conversations: Array<{
    id: string;
    channel: string;
    status: string;
    lastMessagePreview?: string | null;
    lastMessageAt: string;
  }>;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function CustomerDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [activeTab, setActiveTab] = useState<"orders" | "conversations" | "details">("orders");

  const { data, error, isLoading } = useSWR<{ customer: CustomerDetail }>(
    id ? `/api/customers/${id}` : null,
    fetcher,
  );

  const customer = data?.customer;

  if (isLoading || !customer) {
    return (
      <div className="mx-auto max-w-6xl p-12 text-center text-xs text-[var(--text-muted)] font-mono">
        Loading customer details...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Back button */}
      <div>
        <Link
          href="/customers"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-white transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Customers</span>
        </Link>
      </div>

      {/* Header Profile Card */}
      <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-md">
        <div className="flex items-start gap-4">
          <div className="size-14 rounded-2xl bg-gradient-to-br from-blue-600/30 to-purple-600/30 border border-white/10 flex items-center justify-center text-xl font-bold text-white uppercase shadow-inner">
            {customer.name.slice(0, 2)}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[var(--text-primary)]">{customer.name}</h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-[var(--text-secondary)]">
                {customer.status}
              </span>
            </div>
            {customer.company && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Building2 className="size-3.5" />
                <span>{customer.company}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-[var(--text-secondary)] font-mono">
              {customer.whatsapp && (
                <span className="flex items-center gap-1">
                  <MessageCircle className="size-3.5 text-emerald-400" />
                  {customer.whatsapp}
                </span>
              )}
              {customer.email && (
                <span className="flex items-center gap-1">
                  <Mail className="size-3.5 text-blue-400" />
                  {customer.email}
                </span>
              )}
              {customer.phone && !customer.whatsapp && (
                <span className="flex items-center gap-1">
                  <Phone className="size-3.5 text-amber-400" />
                  {customer.phone}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t md:border-t-0 md:border-l border-[var(--border-subtle)] pt-4 md:pt-0 md:pl-6 text-xs">
          <div>
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Orders</span>
            <span className="text-base font-bold font-mono text-[var(--text-primary)]">{customer.orderCount}</span>
          </div>
          <div>
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Lifetime Spend</span>
            <span className="text-base font-bold font-mono text-emerald-400">
              ₹{(customer.totalSpendMinor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Payment Terms</span>
            <span className="text-base font-bold font-mono text-blue-400">
              {customer.paymentTermsDays ? `Net ${customer.paymentTermsDays}` : "Immediate"}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)]">
        {[
          { id: "orders", label: `Orders (${customer.orders.length})`, icon: ShoppingCart },
          { id: "conversations", label: `Conversations (${customer.conversations.length})`, icon: MessageCircle },
          { id: "details", label: "Account Details", icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all cursor-pointer",
                isActive
                  ? "border-red-500 text-white"
                  : "border-transparent text-[var(--text-muted)] hover:text-white hover:border-white/20",
              )}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content: Orders Tab */}
      {activeTab === "orders" && (
        <div className="space-y-4">
          {customer.orders.length === 0 ? (
            <div className="p-12 text-center text-xs text-[var(--text-muted)] font-mono rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]">
              No orders placed by this customer yet.
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.02] border-b border-[var(--border-subtle)] font-mono uppercase text-[10px] text-[var(--text-muted)]">
                  <tr>
                    <th className="p-3.5">Order</th>
                    <th className="p-3.5">Date</th>
                    <th className="p-3.5">Order Status</th>
                    <th className="p-3.5">Payment</th>
                    <th className="p-3.5 text-right">Total</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {customer.orders.map((order) => (
                    <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-3.5 font-mono font-bold text-white">
                        <Link href={`/orders/${order.id}`} className="hover:text-red-400">
                          {order.orderNumber || order.draftNumber}
                        </Link>
                      </td>
                      <td className="p-3.5 text-[var(--text-muted)] font-mono">
                        {new Date(order.createdAt).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white/[0.05] border border-white/10 text-white">
                          {order.status}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-mono font-bold border",
                            order.paymentStatus === "PAID"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                              : order.paymentStatus === "PARTIAL"
                                ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                : "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
                          )}
                        >
                          {order.paymentStatus}
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold text-white">
                        ₹{(order.totalMinor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3.5 text-right">
                        <Link
                          href={`/orders/${order.id}`}
                          className="px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-white text-[11px] font-semibold border border-white/10 transition-colors inline-flex items-center gap-1"
                        >
                          <span>View</span>
                          <ExternalLink className="size-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Conversations Tab */}
      {activeTab === "conversations" && (
        <div className="space-y-4">
          {customer.conversations.length === 0 ? (
            <div className="p-12 text-center text-xs text-[var(--text-muted)] font-mono rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]">
              No conversations found.
            </div>
          ) : (
            <div className="space-y-2">
              {customer.conversations.map((conv) => (
                <div
                  key={conv.id}
                  className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-white uppercase">{conv.channel}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.05] border border-white/10 text-[var(--text-secondary)]">
                        {conv.status}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-1">
                      {conv.lastMessagePreview ?? "(no preview)"}
                    </p>
                  </div>
                  <Link
                    href={`/conversations?id=${conv.id}`}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors"
                  >
                    Open Thread →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Details */}
      {activeTab === "details" && (
        <div className="p-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[var(--text-muted)] block text-[11px]">GST / Tax ID</span>
              <span className="font-mono font-bold text-white">{customer.taxId || "Not registered"}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block text-[11px]">Payment Terms</span>
              <span className="font-mono font-bold text-white">
                {customer.paymentTermsDays ? `${customer.paymentTermsDays} Days` : "None"}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block text-[11px]">Created At</span>
              <span className="font-mono text-white">{new Date(customer.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
