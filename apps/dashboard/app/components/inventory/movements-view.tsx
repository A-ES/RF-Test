"use client";

import React, { useState } from "react";
import useSWR from "swr";
import {
  Clock,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  X,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

interface MovementProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
}

interface MovementOrder {
  id: string;
  orderNumber?: string | null;
  draftNumber?: string | null;
}

interface StockMovementItem {
  id: string;
  createdAt: string;
  delta: number;
  reason: string;
  actorId?: string | null;
  product?: MovementProduct | null;
  order?: MovementOrder | null;
}

interface ProductItem {
  id: string;
  sku: string;
  name: string;
  stock?: {
    onHand: number;
  };
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }
  return res.json();
};

export function StockMovementsView() {
  const [search, setSearch] = useState("");
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);

  const { data, isLoading, mutate } = useSWR(
    "/api/inventory/adjustments?limit=100",
    fetcher,
  );

  const movements: StockMovementItem[] = data?.movements ?? [];

  const filteredMovements = movements.filter((m) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      m.product?.sku?.toLowerCase().includes(term) ||
      m.product?.name?.toLowerCase().includes(term) ||
      m.reason?.toLowerCase().includes(term) ||
      m.order?.orderNumber?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search movements by SKU, product name, or reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void mutate()}
            className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsAdjustModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Record Stock Adjustment
          </button>
        </div>
      </div>

      {/* Movements Table */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] font-medium">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">SKU</th>
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4 text-center">Reason</th>
                <th className="py-3 px-4 text-right">Delta</th>
                <th className="py-3 px-4">Order Reference</th>
                <th className="py-3 px-4">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-[var(--text-primary)]">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--text-muted)]">
                    Loading stock movements...
                  </td>
                </tr>
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--text-muted)]">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No stock movements recorded yet.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => {
                  const dateStr = new Date(m.createdAt).toLocaleString("en-IN", {
                    dateStyle: "short",
                    timeStyle: "short",
                  });
                  const isPositive = m.delta > 0;
                  const isNegative = m.delta < 0;

                  return (
                    <tr key={m.id} className="hover:bg-[var(--surface-elevated)] transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-[var(--text-muted)]">
                        {dateStr}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-[var(--accent)]">
                        {m.product?.sku}
                      </td>
                      <td className="py-3 px-4 font-medium text-[var(--text-primary)]">
                        {m.product?.name}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold",
                            m.reason === "FULFILLMENT"
                              ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                              : m.reason === "ADJUSTMENT"
                              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                              : m.reason === "ORDER_RESERVE"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : m.reason === "ORDER_RELEASE"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
                          )}
                        >
                          {m.reason}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold">
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5",
                            isPositive
                              ? "text-emerald-500"
                              : isNegative
                              ? "text-rose-500"
                              : "text-[var(--text-muted)]",
                          )}
                        >
                          {isPositive && <ArrowUpRight className="w-3 h-3" />}
                          {isNegative && <ArrowDownRight className="w-3 h-3" />}
                          {m.delta > 0 ? `+${m.delta}` : m.delta} {m.product?.unit}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {m.order?.orderNumber || m.order?.draftNumber ? (
                          <span className="text-[var(--text-primary)]">
                            {m.order.orderNumber || m.order.draftNumber}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-[var(--text-muted)]">
                        {m.actorId ? (
                          <span className="truncate max-w-[100px] block">{m.actorId}</span>
                        ) : (
                          "SYSTEM"
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Adjustment Dialog */}
      {isAdjustModalOpen && (
        <DirectAdjustmentDialog
          onClose={() => setIsAdjustModalOpen(false)}
          onSuccess={() => {
            setIsAdjustModalOpen(false);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function DirectAdjustmentDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("ADJUSTMENT");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const { data: prodData } = useSWR("/api/products?limit=100", fetcher);
  const products: ProductItem[] = prodData?.products ?? [];

  const selectedProduct = products.find((p) => p.id === productId);
  const currentOnHand = selectedProduct?.stock?.onHand ?? 0;
  const numDelta = Number(delta) || 0;
  const resultingOnHand = currentOnHand + numDelta;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !numDelta) return;
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          delta: numDelta,
          reason,
          notes,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Adjustment failed");
      }

      onSuccess();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 text-xs">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <h2 className="text-base font-bold text-[var(--text-primary)]">Record Stock Adjustment</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">Select Product *</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
            >
              <option value="">Select a product...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name} (Stock: {p.stock?.onHand ?? 0})
                </option>
              ))}
            </select>
          </div>

          {selectedProduct && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--background)]">
              <div>
                <p className="text-[10px] text-[var(--text-muted)]">Current On Hand</p>
                <p className="text-lg font-mono font-bold text-[var(--text-primary)]">{currentOnHand}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)]">Resulting On Hand</p>
                <p
                  className={cn(
                    "text-lg font-mono font-bold",
                    resultingOnHand < 0 ? "text-rose-500" : "text-emerald-500",
                  )}
                >
                  {resultingOnHand}
                </p>
              </div>
            </div>
          )}

          {resultingOnHand < 0 && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Adjusting below zero requires backorders to be enabled for your organization.
            </div>
          )}

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">
              Stock Delta (+ for addition, - for deduction) *
            </label>
            <input
              type="number"
              placeholder="e.g. +10 or -5"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] font-mono text-base"
            />
          </div>

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">Reason *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
            >
              <option value="ADJUSTMENT">Manual Stock Count Adjustment</option>
              <option value="ERP_SYNC">ERP Integration Sync</option>
              <option value="ORDER_RELEASE">Order Return / Stock Release</option>
            </select>
          </div>

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">Notes (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Count reconciled after physical inventory audit"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
            />
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !productId || !numDelta}
              className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Recording..." : "Save Adjustment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
