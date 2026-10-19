"use client";

import React, { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  Users,
  Search,
  Building2,
  Phone,
  Mail,
  MessageCircle,
  ExternalLink,
  Plus,
  ArrowRight,
  TrendingUp,
  CreditCard,
  Calendar,
} from "lucide-react";

interface CustomerItem {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  status: string;
  orderCount: number;
  totalSpendMinor: number;
  paymentTermsDays?: number | null;
  createdAt: string;
  lastOrderAt?: string | null;
  lastConversationAt?: string | null;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const { data, error, isLoading } = useSWR<{ customers: CustomerItem[] }>(
    `/api/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    fetcher,
  );

  const customers = data?.customers || [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1">
            <Users className="size-3.5 text-blue-400" />
            <span>Directory</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Customers & Accounts
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Omnichannel customer directory, lifetime order history, and account settings.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[var(--text-muted)]" />
        <input
          type="text"
          placeholder="Search by name, company, email, WhatsApp, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--surface-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--focus-ring)]"
        />
      </div>

      {/* Customer Grid */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)] font-mono">
          Loading customer directory...
        </div>
      ) : customers.length === 0 ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)] font-mono rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]">
          No customers found matching search criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:border-[var(--border-hover)] hover:shadow-lg transition-all flex flex-col justify-between group space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-white/10 flex items-center justify-center text-sm font-bold text-white uppercase shadow-inner">
                      {c.name.slice(0, 2)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-[var(--text-primary)] group-hover:text-blue-400 transition-colors">
                        {c.name}
                      </h3>
                      {c.company && (
                        <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                          <Building2 className="size-3" />
                          <span>{c.company}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-[var(--text-secondary)]">
                    {c.status}
                  </span>
                </div>

                <div className="mt-4 space-y-1.5 text-xs text-[var(--text-secondary)]">
                  {c.whatsapp && (
                    <div className="flex items-center gap-2">
                      <MessageCircle className="size-3.5 text-emerald-400" />
                      <span className="font-mono text-[11px]">{c.whatsapp}</span>
                    </div>
                  )}
                  {c.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="size-3.5 text-blue-400" />
                      <span className="truncate">{c.email}</span>
                    </div>
                  )}
                  {c.phone && !c.whatsapp && (
                    <div className="flex items-center gap-2">
                      <Phone className="size-3.5 text-amber-400" />
                      <span className="font-mono text-[11px]">{c.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--border-subtle)] grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] block">Orders</span>
                  <span className="font-bold font-mono text-[var(--text-primary)]">
                    {c.orderCount} orders
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] block">Lifetime Spend</span>
                  <span className="font-bold font-mono text-emerald-400">
                    ₹{(c.totalSpendMinor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
