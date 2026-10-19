"use client";

import React, { useState, useEffect } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ShieldCheck,
  User,
  Phone,
  MessageSquare,
  Building2,
  Calendar,
  MapPin,
  Truck,
  DollarSign,
  Save,
  Check,
  X,
  RefreshCw,
  AlertCircle,
  Package,
  Layers,
  ChevronDown,
  Download,
  FileText,
  Send,
  CreditCard,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { OrderTimeline } from "@/app/components/orders/order-timeline";
import { OrderLifecycleStepper } from "@/app/components/orders/order-lifecycle-stepper";
import { cn } from "@/app/lib/utils";

interface ProductStock {
  onHand: number;
  reserved: number;
}

interface ProductInfo {
  id: string;
  sku: string;
  name: string;
  unit: string;
  inventoryLevel?: ProductStock | null;
}

interface OrderLineItem {
  id: string;
  productId?: string | null;
  sku: string;
  rawText: string;
  matchConfidence: number;
  qty: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
  flagsJson: string;
  product?: ProductInfo | null;
}

interface OrderDetail {
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
  flagsJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  approvedById?: string | null;
  approvedAt?: string | null;
  rejectedReason?: string | null;
  customer?: {
    id: string;
    name: string;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    status: string;
  } | null;
  lines: OrderLineItem[];
  events?: Array<{
    id: string;
    type: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    createdAt: string;
    payloadJson?: string | null;
  }>;
  conversation?: {
    id: string;
    channel: string;
    status: string;
    messages?: Array<{
      id: string;
      sender: string;
      body: string;
      transcript?: string | null;
      createdAt: string;
    }>;
  } | null;
  sourceMessage?: {
    id: string;
    sender: string;
    body: string;
    transcript?: string | null;
    createdAt: string;
  } | null;
  paymentStatus: string;
  totalPaidMinor?: number;
  netPaidMinor?: number;
  outstandingBalanceMinor?: number;
  invoice?: {
    id: string;
    invoiceNumber: string;
    status: string;
    issuedAt: string;
    dueAt: string;
    paymentTerms: string;
    pdfPath?: string | null;
    paymentLinkUrl?: string | null;
    totalMinor: number;
    voidReason?: string | null;
  } | null;
  invoices?: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    issuedAt: string;
    dueAt: string;
    totalMinor: number;
    pdfPath?: string | null;
    paymentLinkUrl?: string | null;
    voidReason?: string | null;
  }>;
  payments?: Array<{
    id: string;
    provider: string;
    providerPaymentId: string;
    amountMinor: number;
    status: string;
    paidAt?: string | null;
  }>;
  fulfillment?: {
    id: string;
    status: string;
    carrier?: string | null;
    trackingRef?: string | null;
    deliveryNote?: string | null;
    notes?: string | null;
  } | null;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params?.id as string;

  const { data, error, isLoading, mutate } = useSWR<{ order: OrderDetail }>(
    orderId ? `/api/orders/${orderId}` : null,
    fetcher,
  );

  const order = data?.order;

  // Local editing state
  const [editableLines, setEditableLines] = useState<
    Array<{
      id: string;
      sku: string;
      productId?: string | null;
      qty: number;
      unitPriceMinor: number;
      rawText: string;
      priceOverrideReason?: string;
    }>
  >([]);
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [deliveryAddress, setDeliveryAddress] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");

  // Approval override state
  const [overrideBlockingFlags, setOverrideBlockingFlags] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // Rejection modal state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [customerMessageText, setCustomerMessageText] = useState("");
  const [confirmSendCustomerMessage, setConfirmSendCustomerMessage] = useState(false);

  // Void and Reissue modal state
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  // Manual payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmountMinor, setPaymentAmountMinor] = useState<number>(0);
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  // Status feedback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "timeline" | "fulfillment">("overview");

  // Sync state from fetched order
  useEffect(() => {
    if (order) {
      setEditableLines(
        order.lines.map((l) => ({
          id: l.id,
          sku: l.sku,
          productId: l.productId,
          qty: l.qty,
          unitPriceMinor: l.unitPriceMinor,
          rawText: l.rawText,
        })),
      );
      setDeliveryDate(
        order.deliveryDate
          ? new Date(order.deliveryDate).toISOString().slice(0, 10)
          : "",
      );
      setDeliveryAddress(order.deliveryAddress || "");
      setInstructions(order.instructions || "");
    }
  }, [order]);

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

  const orderFlags = parseFlags(order?.flagsJson);
  const blockingFlagsList = [
    "INSUFFICIENT_STOCK",
    "OUT_OF_STOCK",
    "UNCLEAR_PRODUCT",
    "NO_PRICE",
    "MISSING_DELIVERY_DATE",
    "MISSING_ADDRESS",
    "NEW_CUSTOMER",
  ];
  const activeBlockingFlags = orderFlags.filter((f) =>
    blockingFlagsList.some((bf) => f === bf || f.startsWith(`${bf}:`)),
  );
  const isApproved = order?.status === "APPROVED";
  const isRejected = order?.status === "REJECTED";
  const canApprove =
    !isApproved &&
    !isRejected &&
    (activeBlockingFlags.length === 0 ||
      (overrideBlockingFlags && overrideReason.trim().length > 0));

  // Handle Save / Re-price draft
  async function handleSaveDraft() {
    if (!order) return;
    setIsSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch(`/api/orders/${order.id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: order.version,
          lines: editableLines.map((l) => ({
            id: l.id,
            sku: l.sku,
            productId: l.productId,
            qty: l.qty,
            unitPriceMinor: l.unitPriceMinor,
            rawText: l.rawText,
          })),
          deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
          deliveryAddress: deliveryAddress.trim() || null,
          instructions: instructions.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to update draft");
      }

      setActionSuccess("Draft recalculated and saved successfully.");
      await mutate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Approve order
  async function handleApproveOrder() {
    if (!order) return;
    setIsSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const idempotencyKey = `approve:${order.id}:v${order.version}`;
      const res = await fetch(`/api/orders/${order.id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          version: order.version,
          overrideBlockingFlags,
          overrideReason: overrideReason.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Approval failed");
      }

      setActionSuccess(
        `Order confirmed and approved as ${json.order.orderNumber}! Stock reserved.`,
      );
      await mutate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Reject order
  async function handleRejectOrder() {
    if (!order || !rejectReason.trim()) {
      setActionError("Rejection reason is required.");
      return;
    }
    setIsSubmitting(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/orders/${order.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: rejectReason.trim(),
          sendCustomerMessage: confirmSendCustomerMessage,
          customerMessage: customerMessageText.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Rejection failed");
      }

      setShowRejectModal(false);
      setActionSuccess("Order draft rejected.");
      await mutate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20 text-[var(--text-muted)]">
        <RefreshCw className="size-6 animate-spin mr-2" />
        Loading order details...
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex-1 p-8 text-center">
        <AlertCircle className="size-10 text-rose-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Order not found</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {error?.message || "The requested order could not be located in your organization."}
        </p>
        <Link
          href="/orders"
          className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
        >
          <ArrowLeft className="size-4" /> Back to Orders
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6 max-w-7xl mx-auto pb-24">
      {/* Top Breadcrumb & Status Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Link
            href="/orders"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-2"
          >
            <ArrowLeft className="size-3.5" /> Back to Orders
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] font-mono">
              {order.orderNumber ? order.orderNumber : order.draftNumber}
            </h1>
            {order.orderNumber && (
              <span className="font-mono text-xs px-2.5 py-0.5 rounded bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                Draft: {order.draftNumber}
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
                order.status === "APPROVED" &&
                  "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                order.status === "NEEDS_REVIEW" &&
                  "bg-amber-500/10 text-amber-400 border-amber-500/20",
                order.status === "DRAFT" &&
                  "bg-blue-500/10 text-blue-400 border-blue-500/20",
                order.status === "REJECTED" &&
                  "bg-rose-500/10 text-rose-400 border-rose-500/20",
              )}
            >
              {order.status === "APPROVED" && <CheckCircle2 className="size-3.5" />}
              {order.status === "NEEDS_REVIEW" && <AlertTriangle className="size-3.5" />}
              {order.status === "DRAFT" && <Clock className="size-3.5" />}
              {order.status === "REJECTED" && <XCircle className="size-3.5" />}
              {order.status.replace(/_/g, " ")}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              Version {order.version}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void mutate()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Action Notifications */}
      {actionError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0 text-rose-400" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-400 hover:text-rose-200"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-emerald-400 hover:text-emerald-200"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Visual Order Lifecycle Pipeline */}
      <OrderLifecycleStepper order={order} />

      {/* Navigation Tabs */}
      <div className="border-b border-[var(--border-subtle)]">
        <nav className="flex space-x-6">
          {[
            { id: "overview", label: "Order Details & Line Items", icon: Package },
            { id: "timeline", label: "Lifecycle & Audit History", icon: Layers },
            { id: "fulfillment", label: "Fulfillment & Tracking", icon: Truck },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={cn(
                  "py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 outline-none cursor-pointer",
                  isActive
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-subtle)]",
                )}
              >
                <Icon className="size-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab 1: Overview & Line Items */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-fade-in">
          {/* Grid Layout: Left Details / Right Gate & Totals */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column (2 cols) */}
            <div className="lg:col-span-2 space-y-6">
          {/* Customer Card */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <User className="size-4 text-[var(--accent)]" />
                Customer Identity
              </h2>
              {order.customer?.status && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {order.customer.status}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-[var(--text-muted)] block">Name</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {order.customer?.name || "Unknown"}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">Company</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {order.customer?.company || "Individual"}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">WhatsApp / Phone</span>
                <span className="font-medium text-[var(--text-primary)] font-mono">
                  {order.customer?.whatsapp || order.customer?.phone || "None"}
                </span>
              </div>
            </div>

            {order.conversation && (
              <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)] flex items-center gap-1.5">
                  <MessageSquare className="size-3.5 text-[var(--accent)]" />
                  Origin: WhatsApp Conversation
                </span>
                <Link
                  href={`/conversations`}
                  className="text-[var(--accent)] hover:underline font-medium"
                >
                  View Conversation Thread →
                </Link>
              </div>
            )}
          </div>

          {/* Original WhatsApp Message Preview */}
          {(order.sourceMessage || order.conversation?.messages?.[0]) && (
            <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-3">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <MessageSquare className="size-4 text-emerald-400" />
                Original WhatsApp Request
              </h2>
              <div className="p-3.5 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-xs space-y-2">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                  <span>Customer Message</span>
                  <span>
                    {new Date(
                      order.sourceMessage?.createdAt ||
                        order.conversation?.messages?.[0]?.createdAt ||
                        order.createdAt,
                    ).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-[var(--text-primary)] font-mono whitespace-pre-wrap">
                  {order.sourceMessage?.body ||
                    order.conversation?.messages?.[0]?.body ||
                    "No message body recorded"}
                </p>
                {(order.sourceMessage?.transcript ||
                  order.conversation?.messages?.[0]?.transcript) && (
                  <div className="pt-2 border-t border-[var(--border-subtle)]">
                    <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider block">
                      Audio Voice Note Transcript
                    </span>
                    <p className="text-xs text-[var(--text-secondary)] italic mt-0.5">
                      "
                      {order.sourceMessage?.transcript ||
                        order.conversation?.messages?.[0]?.transcript}
                      "
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Line Items Table */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Package className="size-4 text-[var(--accent)]" />
                  Order Line Items
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Quantities and SKU matches can be adjusted. Server strictly re-prices totals.
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {editableLines.length} item{editableLines.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                    <th className="py-2.5 px-3">Item / SKU</th>
                    <th className="py-2.5 px-3">Stock Beside</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Unit Price</th>
                    <th className="py-2.5 px-3 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {editableLines.map((line, idx) => {
                    const originalLine = order.lines[idx];
                    const flags = parseFlags(originalLine?.flagsJson);
                    const stock = originalLine?.product?.inventoryLevel;
                    const onHand = stock?.onHand ?? 0;
                    const reserved = stock?.reserved ?? 0;
                    const available = onHand - reserved;
                    const isStockSufficient = available >= line.qty;

                    return (
                      <tr key={line.id || idx} className="hover:bg-[var(--surface-hover)]">
                        {/* SKU & Name */}
                        <td className="py-3 px-3 align-top">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                disabled={isApproved || isRejected}
                                value={line.sku}
                                onChange={(e) => {
                                  const updated = [...editableLines];
                                  updated[idx].sku = e.target.value;
                                  setEditableLines(updated);
                                }}
                                className="font-mono text-xs font-semibold px-2 py-1 rounded bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] w-32 focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] disabled:opacity-70"
                              />
                              <span className="font-medium text-[var(--text-primary)]">
                                {originalLine?.product?.name || line.rawText}
                              </span>
                            </div>

                            {/* Raw extracted text preview */}
                            <div className="text-[11px] text-[var(--text-muted)] italic">
                              "{line.rawText}"
                            </div>

                            {/* Line Flags */}
                            {flags.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                {flags.map((flag, fIdx) => (
                                  <span
                                    key={fIdx}
                                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20"
                                  >
                                    {flag.replace(/_/g, " ")}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Stock Beside Line */}
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          {originalLine?.product ? (
                            <div className="space-y-1">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border",
                                  isStockSufficient
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-rose-500/10 text-rose-400 border-rose-500/20",
                                )}
                              >
                                Avail: {available}
                              </span>
                              <div className="text-[10px] text-[var(--text-muted)]">
                                On hand: {onHand} | Res: {reserved}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-amber-400">
                              Unmatched SKU
                            </span>
                          )}
                        </td>

                        {/* Quantity Input */}
                        <td className="py-3 px-3 align-top text-right">
                          <input
                            type="number"
                            min="1"
                            disabled={isApproved || isRejected}
                            value={line.qty}
                            onChange={(e) => {
                              const updated = [...editableLines];
                              updated[idx].qty = Math.max(1, parseInt(e.target.value) || 1);
                              setEditableLines(updated);
                            }}
                            className="w-16 px-2 py-1 text-right font-mono text-xs rounded bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] disabled:opacity-70"
                          />
                        </td>

                        {/* Unit Price */}
                        <td className="py-3 px-3 align-top text-right font-mono">
                          {formatMoney(line.unitPriceMinor, order.currency)}
                        </td>

                        {/* Line Total */}
                        <td className="py-3 px-3 align-top text-right font-mono font-semibold text-[var(--text-primary)]">
                          {formatMoney(
                            originalLine ? originalLine.lineTotalMinor : line.qty * line.unitPriceMinor,
                            order.currency,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!isApproved && !isRejected && (
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleSaveDraft()}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
                >
                  <Save className="size-3.5" />
                  Save Edits & Recalculate
                </button>
              </div>
            )}
          </div>

          {/* Delivery & Instructions Panel */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Truck className="size-4 text-[var(--accent)]" />
              Delivery & Instructions
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-[var(--text-muted)] font-medium flex items-center gap-1.5">
                  <Calendar className="size-3.5" /> Delivery Date
                </label>
                <input
                  type="date"
                  disabled={isApproved || isRejected}
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] disabled:opacity-70"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[var(--text-muted)] font-medium flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> Delivery Address
                </label>
                <input
                  type="text"
                  disabled={isApproved || isRejected}
                  placeholder="Enter full delivery location"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] disabled:opacity-70"
                />
              </div>

              <div className="md:col-span-2 space-y-1.5">
                <label className="text-[var(--text-muted)] font-medium">
                  Special Instructions
                </label>
                <textarea
                  rows={2}
                  disabled={isApproved || isRejected}
                  placeholder="Notes from customer WhatsApp message..."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] disabled:opacity-70 text-xs"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (Confirmation Gate & Totals) */}
        <div className="space-y-6">
          {/* Server-Driven Totals Panel */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <DollarSign className="size-4 text-[var(--accent)]" />
              Server Pricing & Totals
            </h2>

            <div className="space-y-2 text-xs border-b border-[var(--border-subtle)] pb-4">
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Subtotal</span>
                <span className="font-mono">{formatMoney(order.subtotalMinor, order.currency)}</span>
              </div>
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Discount</span>
                <span className="font-mono text-emerald-400">
                  -{formatMoney(order.discountMinor, order.currency)}
                </span>
              </div>
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Tax (GST)</span>
                <span className="font-mono">{formatMoney(order.taxMinor, order.currency)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[var(--text-primary)]">Total</span>
              <span className="text-xl font-bold font-mono text-[var(--accent)]">
                {formatMoney(order.totalMinor, order.currency)}
              </span>
            </div>

            <p className="text-[11px] text-[var(--text-muted)] italic">
              Computed strictly via priceOrder using organization pricing rules and tax brackets.
            </p>
          </div>

          {/* Blocking Flags & Confirmation Gate Panel */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ShieldCheck className="size-4 text-[var(--accent)]" />
              Confirmation Gate
            </h2>

            {/* Active flags list */}
            {orderFlags.length > 0 ? (
              <div className="space-y-2">
                <span className="text-xs text-[var(--text-muted)] font-medium">Active Flags:</span>
                <div className="space-y-1.5">
                  {orderFlags.map((flag, idx) => {
                    const isBlocking = blockingFlagsList.some(
                      (bf) => flag === bf || flag.startsWith(`${bf}:`),
                    );
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "p-2.5 rounded-lg border text-xs flex items-start gap-2",
                          isBlocking
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                            : "bg-zinc-800/60 border-zinc-700 text-zinc-300",
                        )}
                      >
                        {isBlocking ? (
                          <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
                        ) : (
                          <Clock className="size-4 text-zinc-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <span className="font-semibold">{flag.replace(/_/g, " ")}</span>
                          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                            {flag.startsWith("INSUFFICIENT_STOCK")
                              ? "Inventory is lower than the requested quantity."
                              : flag === "UNCLEAR_PRODUCT"
                              ? "The requested item requires SKU confirmation."
                              : flag === "MISSING_DELIVERY_DATE"
                              ? "Delivery date must be specified."
                              : flag === "NEW_CUSTOMER"
                              ? "First-time lead customer registration."
                              : "Review required prior to approval."}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                <span>All product matches and inventory checks cleared.</span>
              </div>
            )}

            {/* Admin Override Toggle for Blocking Flags */}
            {!isApproved && !isRejected && activeBlockingFlags.length > 0 && (
              <div className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2.5">
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideBlockingFlags}
                    onChange={(e) => setOverrideBlockingFlags(e.target.checked)}
                    className="mt-0.5 rounded text-[var(--accent)] focus:ring-[var(--focus-ring)]"
                  />
                  <span className="text-[var(--text-primary)] font-medium">
                    Override blocking flags (logged in audit log)
                  </span>
                </label>

                {overrideBlockingFlags && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                      Reason for Override *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Inbound stock shipment arriving tomorrow"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Sticky Action Buttons */}
            {!isApproved && !isRejected ? (
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  disabled={!canApprove || isSubmitting}
                  onClick={() => void handleApproveOrder()}
                  className={cn(
                    "w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2",
                    canApprove
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700",
                  )}
                >
                  <CheckCircle2 className="size-4" />
                  {isSubmitting ? "Approving Order..." : "Approve Order & Reserve Stock"}
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setShowRejectModal(true)}
                  className="w-full py-2 px-4 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 transition-colors flex items-center justify-center gap-2"
                >
                  <XCircle className="size-4 text-rose-400" />
                  Reject Draft
                </button>
              </div>
            ) : isApproved ? (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <CheckCircle2 className="size-4" />
                  Confirmed Order #{order.orderNumber}
                </div>
                <p className="text-[11px] text-emerald-300">
                  Stock reserved successfully. Order is approved and ready for invoicing and dispatch.
                </p>
                {order.approvedAt && (
                  <span className="text-[10px] text-[var(--text-muted)] block">
                    Approved at: {new Date(order.approvedAt).toLocaleString()}
                  </span>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-1">
                <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                  <XCircle className="size-4" />
                  Order Draft Rejected
                </div>
                {order.rejectedReason && (
                  <p className="text-xs text-rose-300">
                    Reason: {order.rejectedReason}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Official Invoice Card */}
          {order.invoice && (
            <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <FileText className="size-4 text-[var(--accent)]" />
                  Tax Invoice
                </h2>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono border",
                    order.invoice.status === "PAID"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : order.invoice.status === "VOID"
                      ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      : "bg-blue-500/10 text-blue-400 border-blue-500/20",
                  )}
                >
                  {order.invoice.status}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Invoice Number</span>
                  <span className="font-mono font-bold text-[var(--text-primary)]">
                    {order.invoice.invoiceNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Due Date</span>
                  <span className="text-[var(--text-secondary)]">
                    {new Date(order.invoice.dueAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Payment Terms</span>
                  <span className="text-[var(--text-secondary)]">
                    {order.invoice.paymentTerms}
                  </span>
                </div>
              </div>

              {/* Invoice Action Buttons */}
              <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/orders/${order.id}/invoices/download?invoiceId=${order.invoice?.id}`);
                      const data = await res.json();
                      if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
                    } catch {
                      setActionError("Failed to generate download URL");
                    }
                  }}
                  className="flex-1 py-1.5 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-zinc-800 text-[var(--text-primary)] text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  <Download className="size-3.5" />
                  Download PDF
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setIsSubmitting(true);
                      const res = await fetch(`/api/orders/${order.id}/invoices/resend`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ invoiceId: order.invoice?.id }),
                      });
                      if (res.ok) setActionSuccess("Invoice resent to customer");
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  className="py-1.5 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-zinc-800 text-[var(--text-primary)] text-xs font-medium flex items-center justify-center gap-1.5"
                  title="Resend Invoice to Customer"
                >
                  <Send className="size-3.5" />
                  Resend
                </button>

                <button
                  type="button"
                  onClick={() => setShowVoidModal(true)}
                  className="py-1.5 px-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium flex items-center justify-center gap-1.5"
                  title="Void and reissue invoice keeping number"
                >
                  <RotateCcw className="size-3.5 text-rose-400" />
                  Void & Reissue
                </button>
              </div>
            </div>
          )}

          {/* Payment History & Outstanding Balance Card */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <CreditCard className="size-4 text-emerald-400" />
                Payments & Balance
              </h2>
              <span
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono border",
                  order.paymentStatus === "PAID"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : order.paymentStatus === "PARTIAL"
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/20",
                )}
              >
                {order.paymentStatus}
              </span>
            </div>

            <div className="p-3.5 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-muted)] font-medium">Outstanding Balance:</span>
                <span className="text-base font-bold font-mono text-emerald-400">
                  {formatMoney(order.outstandingBalanceMinor ?? order.totalMinor, order.currency)}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                <span>Total Net Paid:</span>
                <span className="font-mono">{formatMoney(order.netPaidMinor ?? 0, order.currency)}</span>
              </div>
            </div>

            {/* Payment history list */}
            {order.payments && order.payments.length > 0 ? (
              <div className="space-y-2">
                <span className="text-[11px] text-[var(--text-muted)] font-semibold uppercase tracking-wider block">
                  Payment History ({order.payments.length})
                </span>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {order.payments.map((p) => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-xs flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[var(--text-primary)]">{p.provider}</span>
                          <span className="text-[10px] text-[var(--text-muted)] font-mono">
                            {p.providerPaymentId.slice(-10)}
                          </span>
                        </div>
                        {p.paidAt && (
                          <span className="text-[10px] text-[var(--text-muted)] block">
                            {new Date(p.paidAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-bold font-mono text-[var(--text-primary)] block">
                          {formatMoney(p.amountMinor, order.currency)}
                        </span>
                        <span className="text-[10px] text-emerald-400 font-bold uppercase">{p.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] italic">No payments recorded yet.</p>
            )}

            {/* Payment Buttons */}
            <div className="pt-2 border-t border-[var(--border-subtle)] flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    setIsSubmitting(true);
                    const res = await fetch(`/api/orders/${order.id}/payments/resend-link`, {
                      method: "POST",
                    });
                    if (res.ok) setActionSuccess("Payment link resent to customer");
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="flex-1 py-1.5 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] hover:bg-zinc-800 text-[var(--text-primary)] text-xs font-medium flex items-center justify-center gap-1.5"
              >
                <Send className="size-3.5" />
                Resend Link
              </button>

              <button
                type="button"
                onClick={() => {
                  setPaymentAmountMinor(order.outstandingBalanceMinor || order.totalMinor);
                  setShowPaymentModal(true);
                }}
                className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                <DollarSign className="size-3.5" />
                Manual Payment
              </button>
            </div>
          </div>

          {/* Fulfillment Status Card */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Truck className="size-4 text-purple-400" />
                Fulfillment
              </h2>
              <Link
                href="/orders/fulfillment"
                className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1 font-medium"
              >
                View Board <ExternalLink className="size-3" />
              </Link>
            </div>

            <div className="flex items-center justify-between text-xs p-3 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)]">Current Stage:</span>
              <span className="font-mono text-purple-400 font-bold">
                {order.fulfillment?.status || "PENDING"}
              </span>
            </div>

            {order.fulfillment?.carrier && (
              <div className="text-xs text-[var(--text-secondary)] space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Carrier:</span>
                  <span>{order.fulfillment.carrier}</span>
                </div>
                {order.fulfillment.trackingRef && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Tracking Ref:</span>
                    <span className="font-mono text-[var(--text-primary)]">{order.fulfillment.trackingRef}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recent Lifecycle Activity Card */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Clock className="size-4 text-[var(--accent)]" />
                Recent Lifecycle Activity
              </h2>
              <button
                type="button"
                onClick={() => setActiveTab("timeline")}
                className="text-xs text-[var(--accent)] hover:underline font-medium"
              >
                View All →
              </button>
            </div>
            <OrderTimeline orderId={order.id} limit={3} compact />
            <button
              type="button"
              onClick={() => setActiveTab("timeline")}
              className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex items-center justify-center gap-1.5"
            >
              <Layers className="size-3.5 text-[var(--accent)]" />
              View Complete Audit Timeline
            </button>
          </div>
        </div>
      </div>

      {/* Full-width Order Lifecycle Timeline & Audit History Section */}
      <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[rgba(242,78,75,0.12)] text-[var(--accent)] border border-[rgba(242,78,75,0.2)]">
              <Layers className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                Order Lifecycle Timeline & Audit History
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Chronological unified log: order events, state transitions, customer WhatsApp notifications, and payment gateway receipts.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab("timeline")}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
          >
            Dedicated Timeline View →
          </button>
        </div>
        <OrderTimeline orderId={order.id} />
      </div>
    </div>
  )}

  {/* Tab 2: Dedicated Lifecycle & Audit History */}
  {activeTab === "timeline" && (
    <div className="space-y-6 animate-fade-in">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-1">
          <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
            Order Lifecycle State
          </span>
          <div className="text-base font-bold font-mono text-[var(--text-primary)]">
            {order.status.replace(/_/g, " ")}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            Version {order.version} • Draft {order.draftNumber}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-1">
          <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
            Payment Status
          </span>
          <div className="text-base font-bold font-mono text-emerald-400">
            {order.paymentStatus}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            {formatMoney(order.netPaidMinor ?? 0, order.currency)} paid of {formatMoney(order.totalMinor, order.currency)}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-1">
          <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
            Fulfillment Stage
          </span>
          <div className="text-base font-bold font-mono text-purple-400">
            {order.fulfillment?.status || "PENDING"}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            {order.fulfillment?.carrier ? `Carrier: ${order.fulfillment.carrier}` : "Awaiting warehouse fulfillment"}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-1">
          <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
            Audit Trail Scope
          </span>
          <div className="text-base font-bold font-mono text-blue-400">
            Unified Chronology
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            Full compliance & transition history
          </p>
        </div>
      </div>

      {/* Full Width Order Timeline */}
      <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[rgba(242,78,75,0.12)] text-[var(--accent)] border border-[rgba(242,78,75,0.2)]">
              <Layers className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                Order Lifecycle Timeline & Audit History
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Comprehensive record of administrative reviews, inventory stock locks, automated customer notifications, and payments.
              </p>
            </div>
          </div>
        </div>
        <OrderTimeline orderId={order.id} />
      </div>
    </div>
  )}

  {/* Tab 3: Dedicated Fulfillment & Shipping */}
  {activeTab === "fulfillment" && (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Logistics & Delivery Details */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Truck className="size-4 text-purple-400" />
                Logistics & Warehouse Progress
              </h2>
              <Link
                href="/orders/fulfillment"
                className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1 font-medium"
              >
                Open Warehouse Kanban <ExternalLink className="size-3" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-1">
                <span className="text-[var(--text-muted)] block">Current Fulfillment Status</span>
                <span className="font-mono text-purple-400 font-bold text-sm">
                  {order.fulfillment?.status || "PENDING"}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-1">
                <span className="text-[var(--text-muted)] block">Logistics Carrier</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {order.fulfillment?.carrier || "Not assigned yet"}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-1">
                <span className="text-[var(--text-muted)] block">Tracking Reference</span>
                <span className="font-mono font-medium text-[var(--text-primary)]">
                  {order.fulfillment?.trackingRef || "Pending dispatch scan"}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-1">
                <span className="text-[var(--text-muted)] block">Target Delivery Date</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {order.deliveryDate
                    ? new Date(order.deliveryDate).toLocaleDateString()
                    : "Standard SLA schedule"}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-1 text-xs">
              <span className="text-[var(--text-muted)] block">Shipping Destination</span>
              <p className="text-[var(--text-primary)] font-medium">
                {order.deliveryAddress || "Standard Organization Billing Address"}
              </p>
            </div>

            {order.instructions && (
              <div className="p-3.5 rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] space-y-1 text-xs">
                <span className="text-[var(--text-muted)] block">Customer Delivery Instructions</span>
                <p className="text-[var(--text-secondary)] italic">{order.instructions}</p>
              </div>
            )}
          </div>

          {/* Ordered Line Items in Fulfillment */}
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Package className="size-4 text-[var(--accent)]" />
              Items Scheduled for Dispatch ({order.lines.length})
            </h2>
            <div className="divide-y divide-[var(--border-subtle)]">
              {order.lines.map((line) => (
                <div key={line.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-bold text-[var(--text-primary)]">{line.sku}</span>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      {line.product?.name || line.rawText}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-[var(--accent)] text-sm">
                    Qty: {line.qty}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Fulfillment Timeline */}
        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Clock className="size-4 text-purple-400" />
              Fulfillment Updates
            </h2>
            <OrderTimeline orderId={order.id} compact />
          </div>
        </div>
      </div>
    </div>
  )}

      {/* Void and Reissue Modal */}
      {showVoidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <RotateCcw className="size-5 text-rose-400" />
                Void & Reissue Invoice
              </h3>
              <button
                type="button"
                onClick={() => setShowVoidModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="text-xs text-[var(--text-secondary)]">
              Admin action: The original invoice number <strong className="font-mono">{order.invoice?.invoiceNumber}</strong> is strictly kept, and the void reason is permanently audited.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--text-primary)]">
                Reason for Void & Reissue *
              </label>
              <textarea
                rows={3}
                required
                placeholder="e.g. Corrected buyer tax identification number or billing terms..."
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowVoidModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface-card)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!voidReason.trim() || isSubmitting}
                onClick={async () => {
                  try {
                    setIsSubmitting(true);
                    const res = await fetch(`/api/orders/${order.id}/invoices/void-reissue`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        invoiceId: order.invoice?.id,
                        reason: voidReason.trim(),
                      }),
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error || "Void failed");
                    setActionSuccess(`Invoice reissued: ${json.invoice.invoiceNumber}`);
                    setShowVoidModal(false);
                    setVoidReason("");
                    await mutate();
                  } catch (err: unknown) {
                    setActionError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
              >
                {isSubmitting ? "Reissuing..." : "Confirm Void & Reissue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Payment Entry Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <DollarSign className="size-5 text-emerald-400" />
                Record Manual Payment
              </h3>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-primary)]">Payment Amount (Paise / Minor) *</label>
                <input
                  type="number"
                  value={paymentAmountMinor}
                  onChange={(e) => setPaymentAmountMinor(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                />
                <span className="text-[11px] text-[var(--text-muted)]">
                  Formatted: {formatMoney(paymentAmountMinor, order.currency)}
                </span>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-primary)]">Payment Reference / UTR *</label>
                <input
                  type="text"
                  placeholder="e.g. NEFT-987654321, CASH-REC-01"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-primary)]">Notes</label>
                <input
                  type="text"
                  placeholder="Direct bank transfer verified by finance team..."
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface-card)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={paymentAmountMinor <= 0 || !paymentRef.trim() || isSubmitting}
                onClick={async () => {
                  try {
                    setIsSubmitting(true);
                    const res = await fetch(`/api/orders/${order.id}/payments/manual`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        amountMinor: paymentAmountMinor,
                        reference: paymentRef.trim(),
                        notes: paymentNotes.trim() || undefined,
                      }),
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error || "Payment recording failed");
                    setActionSuccess("Manual payment recorded successfully");
                    setShowPaymentModal(false);
                    setPaymentRef("");
                    setPaymentNotes("");
                    await mutate();
                  } catch (err: unknown) {
                    setActionError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {isSubmitting ? "Recording..." : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <XCircle className="size-5 text-rose-400" />
                Reject Order Draft
              </h3>
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="text-xs text-[var(--text-secondary)]">
              Rejecting will mark the draft as rejected. Reservations will be released if held, or nothing released if never approved.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--text-primary)]">
                Rejection Reason *
              </label>
              <textarea
                rows={3}
                required
                placeholder="Reason for rejecting this draft..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)]"
              />
            </div>

            {order.conversation && (
              <div className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmSendCustomerMessage}
                    onChange={(e) => setConfirmSendCustomerMessage(e.target.checked)}
                    className="mt-0.5 rounded text-[var(--accent)]"
                  />
                  <span className="text-[var(--text-primary)] font-medium">
                    Send rejection message to customer on WhatsApp
                  </span>
                </label>

                {confirmSendCustomerMessage && (
                  <div className="space-y-1 pt-1">
                    <label className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">
                      Customer Message Text *
                    </label>
                    <textarea
                      rows={2}
                      value={customerMessageText}
                      onChange={(e) => setCustomerMessageText(e.target.value)}
                      placeholder="Message sent to the customer..."
                      className="w-full px-2.5 py-1.5 text-xs rounded bg-[var(--surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface-card)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || isSubmitting}
                onClick={() => void handleRejectOrder()}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
              >
                {isSubmitting ? "Rejecting..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
