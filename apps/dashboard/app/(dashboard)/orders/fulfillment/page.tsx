"use client";

import React, { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  Truck,
  Package,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
  RefreshCw,
  ExternalLink,
  X,
  ShieldAlert,
  ChevronRight,
  Calendar,
  MapPin,
  FileText,
  DollarSign,
  AlertCircle,
  Building2,
} from "lucide-react";
import { OrderTimeline } from "@/app/components/orders/order-timeline";
import { cn } from "@/app/lib/utils";

interface FulfillmentItem {
  id: string;
  orderId: string;
  status: "PENDING" | "PACKING" | "DISPATCHED" | "DELIVERED";
  carrier?: string | null;
  trackingRef?: string | null;
  deliveryNote?: string | null;
  notes?: string | null;
  overrideReason?: string | null;
  dispatchedAt?: string | null;
  deliveredAt?: string | null;
  order: {
    id: string;
    orderNumber?: string | null;
    draftNumber: string;
    status: string;
    paymentStatus: string;
    totalMinor: number;
    currency: string;
    deliveryDate?: string | null;
    deliveryAddress?: string | null;
    instructions?: string | null;
    customer: {
      name: string;
      company?: string | null;
      phone?: string | null;
      whatsapp?: string | null;
    };
    lines: Array<{
      id: string;
      sku: string;
      qty: number;
      rawText: string;
      product?: {
        name: string;
        reorderLevel?: number | null;
      } | null;
    }>;
  };
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const COLUMNS: Array<{
  id: "PENDING" | "PACKING" | "DISPATCHED" | "DELIVERED";
  label: string;
  icon: typeof Clock;
  color: string;
  badgeBg: string;
}> = [
  {
    id: "PENDING",
    label: "Pending",
    icon: Clock,
    color: "text-amber-400",
    badgeBg: "bg-amber-500/10 border-amber-500/20 text-amber-300",
  },
  {
    id: "PACKING",
    label: "Packing",
    icon: Package,
    color: "text-blue-400",
    badgeBg: "bg-blue-500/10 border-blue-500/20 text-blue-300",
  },
  {
    id: "DISPATCHED",
    label: "Dispatched",
    icon: Truck,
    color: "text-purple-400",
    badgeBg: "bg-purple-500/10 border-purple-500/20 text-purple-300",
  },
  {
    id: "DELIVERED",
    label: "Delivered",
    icon: CheckCircle2,
    color: "text-emerald-400",
    badgeBg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
  },
];

export default function FulfillmentBoardPage() {
  const { data, error, isLoading, mutate } = useSWR<{ fulfillments: FulfillmentItem[] }>(
    "/api/fulfillments",
    fetcher,
    { refreshInterval: 5000 },
  );

  const [selectedItem, setSelectedItem] = useState<FulfillmentItem | null>(null);

  // Transition form state
  const [carrier, setCarrier] = useState("");
  const [trackingRef, setTrackingRef] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Revert state
  const [showRevertSection, setShowRevertSection] = useState(false);
  const [revertTargetStatus, setRevertTargetStatus] = useState<"PENDING" | "PACKING" | "DISPATCHED">("PENDING");
  const [revertReason, setRevertReason] = useState("");

  const fulfillments = data?.fulfillments || [];

  function openDrawer(item: FulfillmentItem) {
    setSelectedItem(item);
    setCarrier(item.carrier || "");
    setTrackingRef(item.trackingRef || "");
    setDeliveryNote(item.deliveryNote || "");
    setOverrideReason("");
    setActionError(null);
    setActionSuccess(null);
    setShowRevertSection(false);
    setRevertReason("");
  }

  function closeDrawer() {
    setSelectedItem(null);
  }

  async function handleForwardTransition(nextStatus: "PACKING" | "DISPATCHED" | "DELIVERED") {
    if (!selectedItem) return;
    setIsSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch(`/api/orders/${selectedItem.order.id}/fulfillment/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus: nextStatus,
          carrier: carrier.trim() || undefined,
          trackingRef: trackingRef.trim() || undefined,
          deliveryNote: deliveryNote.trim() || undefined,
          overrideReason: overrideReason.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Transition to ${nextStatus} failed`);
      }

      setActionSuccess(`Successfully transitioned to ${nextStatus}`);
      await mutate();
      setSelectedItem((prev) =>
        prev
          ? {
              ...prev,
              status: nextStatus,
              carrier: carrier || prev.carrier,
              trackingRef: trackingRef || prev.trackingRef,
              deliveryNote: deliveryNote || prev.deliveryNote,
            }
          : null,
      );
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAdminRevert() {
    if (!selectedItem || !revertReason.trim()) return;
    setIsSubmitting(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/orders/${selectedItem.order.id}/fulfillment/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus: revertTargetStatus,
          overrideReason: revertReason.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Revert to ${revertTargetStatus} failed`);
      }

      setActionSuccess(`Admin reverted status to ${revertTargetStatus}`);
      setShowRevertSection(false);
      setRevertReason("");
      await mutate();
      setSelectedItem((prev) =>
        prev ? { ...prev, status: revertTargetStatus } : null,
      );
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetryErp() {
    if (!selectedItem) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${selectedItem.order.id}/fulfillment/retry-erp`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "ERP retry failed");
      setActionSuccess("ERP sync retry queued successfully");
      await mutate();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2">
            <Truck className="size-6 text-[var(--accent)]" />
            Fulfillment Board
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Realtime warehouse workflow: Pending → Packing → Dispatched → Delivered. Forward-only transitions with ERP seam.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/orders"
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-card)] text-[var(--text-secondary)] font-medium transition-colors"
          >
            Back to Orders
          </Link>
          <button
            type="button"
            onClick={() => void mutate()}
            className="p-2 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors"
            title="Refresh Board"
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const items = fulfillments.filter((f) => f.status === col.id);
          const ColIcon = col.icon;

          return (
            <div
              key={col.id}
              className="flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/60 backdrop-blur-sm p-3 min-h-[550px]"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between p-2 border-b border-[var(--border-subtle)] mb-3">
                <div className="flex items-center gap-2">
                  <ColIcon className={cn("size-4", col.color)} />
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                    {col.label}
                  </span>
                </div>
                <span className={cn("px-2 py-0.5 rounded-full text-xs font-mono font-bold border", col.badgeBg)}>
                  {items.length}
                </span>
              </div>

              {/* Cards List */}
              <div className="flex-1 space-y-3 overflow-y-auto max-h-[750px] pr-1">
                {items.length === 0 ? (
                  <div className="h-32 flex flex-col items-center justify-center text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-xl p-4">
                    <span>No orders {col.label.toLowerCase()}</span>
                  </div>
                ) : (
                  items.map((item) => {
                    const totalQty = item.order.lines.reduce((s, l) => s + l.qty, 0);

                    return (
                      <div
                        key={item.id}
                        onClick={() => openDrawer(item)}
                        className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:border-[var(--focus-ring)] hover:shadow-md cursor-pointer transition-all space-y-2.5"
                      >
                        {/* Header: Order Number & Customer */}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-mono font-bold text-xs text-[var(--text-primary)] block">
                              {item.order.orderNumber || item.order.draftNumber}
                            </span>
                            <span className="text-xs text-[var(--text-secondary)] font-medium line-clamp-1">
                              {item.order.customer.company || item.order.customer.name}
                            </span>
                          </div>

                          {/* Payment Status Badge */}
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase font-mono border",
                              item.order.paymentStatus === "PAID"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : item.order.paymentStatus === "PARTIAL"
                                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                : "bg-amber-500/10 text-amber-400 border-amber-500/20",
                            )}
                          >
                            {item.order.paymentStatus}
                          </span>
                        </div>

                        {/* Items count & preview */}
                        <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                          <Package className="size-3.5 text-[var(--text-secondary)]" />
                          <span>
                            {item.order.lines.length} items ({totalQty} units)
                          </span>
                        </div>

                        {/* Delivery address & date */}
                        {item.order.deliveryDate && (
                          <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                            <Calendar className="size-3.5 text-[var(--text-secondary)]" />
                            <span>Due: {new Date(item.order.deliveryDate).toLocaleDateString()}</span>
                          </div>
                        )}

                        {item.carrier && (
                          <div className="text-[11px] text-purple-300 font-medium flex items-center gap-1.5 pt-1 border-t border-[var(--border-subtle)]">
                            <Truck className="size-3.5" />
                            <span className="line-clamp-1">
                              {item.carrier} {item.trackingRef ? `(${item.trackingRef})` : ""}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fulfillment Drawer */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="w-full max-w-xl bg-[var(--surface-elevated)] border-l border-[var(--border-subtle)] h-full overflow-y-auto p-6 space-y-6 shadow-2xl flex flex-col justify-between">
            <div className="space-y-6">
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border-subtle)]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-lg font-bold text-[var(--text-primary)]">
                      {selectedItem.order.orderNumber || selectedItem.order.draftNumber}
                    </span>
                    <span
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-xs font-bold uppercase font-mono border",
                        selectedItem.status === "DELIVERED"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : selectedItem.status === "DISPATCHED"
                          ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                          : selectedItem.status === "PACKING"
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20",
                      )}
                    >
                      {selectedItem.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Customer: {selectedItem.order.customer.company || selectedItem.order.customer.name}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/orders/${selectedItem.order.id}`}
                    className="p-2 rounded-lg bg-[var(--surface-card)] hover:bg-zinc-800 text-[var(--text-secondary)] transition-colors"
                    title="View Full Order"
                  >
                    <ExternalLink className="size-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="p-2 rounded-lg bg-[var(--surface-card)] hover:bg-zinc-800 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="size-5" />
                  </button>
                </div>
              </div>

              {/* Status & Action Feedback */}
              {actionError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="size-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{actionError}</span>
                </div>
              )}
              {actionSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{actionSuccess}</span>
                </div>
              )}

              {/* Order & Delivery Details */}
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Delivery Information
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[var(--text-muted)] block text-[11px]">Address</span>
                    <span className="text-[var(--text-primary)] font-medium">
                      {selectedItem.order.deliveryAddress || "Standard Billing Address"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--text-muted)] block text-[11px]">Delivery Date</span>
                    <span className="text-[var(--text-primary)] font-medium">
                      {selectedItem.order.deliveryDate
                        ? new Date(selectedItem.order.deliveryDate).toLocaleDateString()
                        : "As soon as possible"}
                    </span>
                  </div>
                </div>

                {selectedItem.order.instructions && (
                  <div className="pt-2 border-t border-[var(--border-subtle)] text-xs">
                    <span className="text-[var(--text-muted)] block text-[11px]">Instructions</span>
                    <p className="text-[var(--text-secondary)] italic">{selectedItem.order.instructions}</p>
                  </div>
                )}
              </div>

              {/* Products Table in Drawer */}
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
                  <span>Ordered Items</span>
                  <span>{selectedItem.order.lines.length} Lines</span>
                </h3>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {selectedItem.order.lines.map((line) => (
                    <div
                      key={line.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-[var(--text-primary)] block">
                          {line.sku}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {line.product?.name || line.rawText}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-[var(--accent)] text-sm">
                        x{line.qty}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Forward Transition Form */}
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Logistics & Tracking Info
                </h3>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-[var(--text-muted)] font-medium text-[11px]">Carrier</label>
                    <input
                      type="text"
                      placeholder="e.g. BlueDart, Delhivery"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs focus:ring-1 focus:ring-[var(--focus-ring)]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[var(--text-muted)] font-medium text-[11px]">Tracking Reference</label>
                    <input
                      type="text"
                      placeholder="e.g. TRK987654321"
                      value={trackingRef}
                      onChange={(e) => setTrackingRef(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs focus:ring-1 focus:ring-[var(--focus-ring)]"
                    />
                  </div>

                  <div className="col-span-2 space-y-1">
                    <label className="text-[var(--text-muted)] font-medium text-[11px]">Delivery Note / Instructions</label>
                    <input
                      type="text"
                      placeholder="Notes for courier or warehouse"
                      value={deliveryNote}
                      onChange={(e) => setDeliveryNote(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs focus:ring-1 focus:ring-[var(--focus-ring)]"
                    />
                  </div>
                </div>

                {/* If moving to PACKING and payment is unpaid, offer admin override input */}
                {selectedItem.status === "PENDING" && selectedItem.order.paymentStatus !== "PAID" && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs space-y-2">
                    <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                      <AlertTriangle className="size-4" />
                      <span>Payment Rule: Order is currently {selectedItem.order.paymentStatus}</span>
                    </div>
                    <p className="text-[11px] text-amber-300">
                      Packing requires paid payment terms unless an administrator provides a logged override reason.
                    </p>
                    <input
                      type="text"
                      placeholder="Admin override reason (e.g. Terms customer approved for packing)..."
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded bg-[var(--surface-elevated)] border border-amber-500/30 text-[var(--text-primary)] text-xs"
                    />
                  </div>
                )}

                {/* Forward Status Buttons */}
                <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                  {selectedItem.status === "PENDING" && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleForwardTransition("PACKING")}
                      className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm"
                    >
                      <Package className="size-4" />
                      Move to Packing
                    </button>
                  )}

                  {selectedItem.status === "PACKING" && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleForwardTransition("DISPATCHED")}
                      className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm"
                    >
                      <Truck className="size-4" />
                      Commit Stock & Dispatch Order
                    </button>
                  )}

                  {selectedItem.status === "DISPATCHED" && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleForwardTransition("DELIVERED")}
                      className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm"
                    >
                      <CheckCircle2 className="size-4" />
                      Mark Order Delivered
                    </button>
                  )}

                  {selectedItem.status === "DELIVERED" && (
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xs text-center">
                      Order Fully Delivered & Fulfilled
                    </div>
                  )}
                </div>
              </div>

              {/* Order Lifecycle Timeline */}
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                  <Clock className="size-3.5 text-blue-400" />
                  Order Lifecycle Timeline
                </h3>
                <OrderTimeline orderId={selectedItem.order.id} />
              </div>

              {/* Admin Revert Section */}
              {selectedItem.status !== "PENDING" && (
                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                      <RotateCcw className="size-3.5 text-rose-400" />
                      Admin Revert (Backward Transition)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowRevertSection(!showRevertSection)}
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
                    >
                      {showRevertSection ? "Hide Revert" : "Revert Status"}
                    </button>
                  </div>

                  {showRevertSection && (
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <label className="text-[11px] text-[var(--text-muted)]">Target Status</label>
                          <select
                            value={revertTargetStatus}
                            onChange={(e) =>
                              setRevertTargetStatus(e.target.value as "PENDING" | "PACKING" | "DISPATCHED")
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs"
                          >
                            <option value="PENDING">Revert to Pending</option>
                            {selectedItem.status === "DISPATCHED" && <option value="PACKING">Revert to Packing</option>}
                            {selectedItem.status === "DELIVERED" && <option value="DISPATCHED">Revert to Dispatched</option>}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] text-[var(--text-muted)]">Revert Reason *</label>
                          <input
                            type="text"
                            placeholder="Reason for reverting..."
                            value={revertReason}
                            onChange={(e) => setRevertReason(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!revertReason.trim() || isSubmitting}
                        onClick={() => void handleAdminRevert()}
                        className="w-full py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs disabled:opacity-50 transition-colors"
                      >
                        Confirm Admin Revert
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Drawer Footer with ERP Retry Button */}
            <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => void handleRetryErp()}
                disabled={isSubmitting}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-zinc-800 text-[var(--text-secondary)] font-medium flex items-center gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                Retry ERP Sync
              </button>

              <button
                type="button"
                onClick={closeDrawer}
                className="px-4 py-1.5 rounded-lg bg-[var(--surface-card)] hover:bg-zinc-800 text-[var(--text-primary)] font-medium"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
