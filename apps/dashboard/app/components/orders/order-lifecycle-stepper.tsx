"use client";

import React from "react";
import {
  FileText,
  ShieldCheck,
  CreditCard,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

export interface LifecycleOrderData {
  id: string;
  draftNumber: string;
  orderNumber: string | null;
  status: string;
  currency: string;
  totalMinor: number;
  createdAt: string;
  approvedAt?: string | null;
  rejectedReason?: string | null;
  paymentStatus: string;
  netPaidMinor?: number;
  invoice?: {
    id: string;
    invoiceNumber: string;
    status: string;
  } | null;
  fulfillment?: {
    id: string;
    status: string;
    carrier?: string | null;
    trackingRef?: string | null;
  } | null;
}

interface StepDef {
  key: string;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
  state: "completed" | "current" | "pending" | "failed";
  timestamp?: string | null;
}

export function OrderLifecycleStepper({
  order,
  className,
}: {
  order: LifecycleOrderData;
  className?: string;
}) {
  function formatMoney(minor: number = 0, currency = "INR") {
    const rupees = minor / 100;
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(rupees);
  }

  const isRejected = order.status === "REJECTED";
  const isCancelled = order.status === "CANCELLED";
  const isApproved =
    Boolean(order.approvedAt) ||
    ["APPROVED", "PACKING", "DISPATCHED", "DELIVERED"].includes(order.status) ||
    ["PACKING", "DISPATCHED", "DELIVERED"].includes(order.fulfillment?.status || "");

  const fStatus = order.fulfillment?.status || "PENDING";
  const isPackingDone = ["DISPATCHED", "DELIVERED"].includes(fStatus);
  const isDispatchedDone = fStatus === "DELIVERED";
  const isDelivered = fStatus === "DELIVERED" || order.status === "DELIVERED";

  const isPaid = order.paymentStatus === "PAID";
  const isPartial = order.paymentStatus === "PARTIAL";

  const steps: StepDef[] = [
    // 1. Draft Created
    {
      key: "draft",
      label: "Order Created",
      sublabel: `Draft: ${order.draftNumber}`,
      icon: FileText,
      state: "completed",
      timestamp: new Date(order.createdAt).toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric",
      }),
    },

    // 2. Review & Approval
    {
      key: "approval",
      label: "Approval Gate",
      sublabel: isRejected
        ? "Order Rejected"
        : isApproved
        ? order.orderNumber
          ? `Confirmed #${order.orderNumber}`
          : "Approved & Reserved"
        : "Awaiting Review",
      icon: isRejected ? XCircle : ShieldCheck,
      state: isRejected ? "failed" : isApproved ? "completed" : "current",
      timestamp: order.approvedAt
        ? new Date(order.approvedAt).toLocaleDateString("en-IN", {
            month: "short",
            day: "numeric",
          })
        : null,
    },

    // 3. Invoice & Payment
    {
      key: "invoice_payment",
      label: "Invoice & Payment",
      sublabel: isPaid
        ? `Paid in Full (${formatMoney(order.netPaidMinor ?? order.totalMinor, order.currency)})`
        : isPartial
        ? `Partial (${formatMoney(order.netPaidMinor ?? 0, order.currency)})`
        : order.invoice
        ? `Inv #${order.invoice.invoiceNumber}`
        : isApproved
        ? "Payment Pending"
        : "Pending Approval",
      icon: CreditCard,
      state: isPaid
        ? "completed"
        : order.invoice || isPartial || isApproved
        ? "current"
        : "pending",
    },

    // 4. Warehouse Packing
    {
      key: "packing",
      label: "Warehouse Packing",
      sublabel: isPackingDone
        ? "Stock Packed & Ready"
        : fStatus === "PACKING"
        ? "Picking & Packing"
        : isApproved
        ? "Queued in Warehouse"
        : "Pending Approval",
      icon: Package,
      state: isPackingDone
        ? "completed"
        : fStatus === "PACKING"
        ? "current"
        : "pending",
    },

    // 5. Dispatch & Transit
    {
      key: "dispatch",
      label: "Dispatch & Logistics",
      sublabel:
        fStatus === "DISPATCHED" || fStatus === "DELIVERED"
          ? order.fulfillment?.carrier
            ? `${order.fulfillment.carrier}${order.fulfillment.trackingRef ? ` • ${order.fulfillment.trackingRef}` : ""}`
            : "In Transit with Carrier"
          : isPackingDone
          ? "Ready for Dispatch"
          : "Awaiting Warehouse",
      icon: Truck,
      state: isDispatchedDone
        ? "completed"
        : fStatus === "DISPATCHED"
        ? "current"
        : "pending",
    },

    // 6. Delivered
    {
      key: "delivery",
      label: "Delivered & Closed",
      sublabel: isDelivered ? "Delivered to Customer" : "Pending Final Delivery",
      icon: CheckCircle2,
      state: isDelivered ? "completed" : "pending",
    },
  ];

  // Calculate percentage of progress
  const completedCount = steps.filter((s) => s.state === "completed").length;
  const progressPercent = Math.min(100, Math.round((completedCount / (steps.length - 1)) * 100));

  return (
    <div
      className={cn(
        "p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] space-y-4 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      {/* Header bar with Status Pill & Progress Percentage */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[rgba(242,78,75,0.12)] text-[var(--accent)] border border-[rgba(242,78,75,0.2)]">
            <Clock className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              Order Lifecycle Pipeline
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Real-time progress across approval, invoicing, warehouse packing, and delivery.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <span className="text-[10px] uppercase font-mono text-[var(--text-muted)] block">
              Lifecycle Stage
            </span>
            <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
              {isDelivered
                ? "COMPLETED"
                : isRejected
                ? "REJECTED"
                : fStatus === "DISPATCHED"
                ? "IN TRANSIT"
                : fStatus === "PACKING"
                ? "WAREHOUSE PACKING"
                : isApproved
                ? "APPROVED & PROCESSING"
                : "PENDING APPROVAL"}
            </span>
          </div>

          <div className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--accent)]">
            {progressPercent}% Complete
          </div>
        </div>
      </div>

      {/* Stepper Graphic */}
      <div className="relative pt-2 pb-1 overflow-x-auto">
        <div className="min-w-[680px]">
          {/* Progress bar background line */}
          <div className="absolute top-[28px] left-6 right-6 h-0.5 bg-zinc-800 -z-0" />
          <div
            className="absolute top-[28px] left-6 h-0.5 bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500 -z-0 transition-all duration-700"
            style={{ width: `calc(${progressPercent}% - 3rem)` }}
          />

          {/* Stepper Steps */}
          <div className="grid grid-cols-6 gap-2 relative z-10">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              const isComp = step.state === "completed";
              const isCurr = step.state === "current";
              const isFail = step.state === "failed";

              return (
                <div key={step.key} className="flex flex-col items-center text-center group">
                  {/* Step Circle */}
                  <div
                    className={cn(
                      "size-9 rounded-full flex items-center justify-center transition-all duration-300 relative",
                      isComp &&
                        "bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.35)] ring-4 ring-emerald-500/10",
                      isCurr &&
                        "bg-blue-600 text-white ring-4 ring-blue-500/25 animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.4)]",
                      isFail &&
                        "bg-rose-500 text-white ring-4 ring-rose-500/25 shadow-[0_0_15px_rgba(244,63,94,0.4)]",
                      !isComp &&
                        !isCurr &&
                        !isFail &&
                        "bg-[var(--surface-card)] border border-zinc-700 text-zinc-500",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {isCurr && (
                      <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-blue-400 animate-ping" />
                    )}
                  </div>

                  {/* Step Label */}
                  <span
                    className={cn(
                      "mt-2 text-xs font-semibold tracking-tight",
                      isComp && "text-[var(--text-primary)]",
                      isCurr && "text-blue-400 font-bold",
                      isFail && "text-rose-400 font-bold",
                      !isComp && !isCurr && !isFail && "text-zinc-500",
                    )}
                  >
                    {step.label}
                  </span>

                  {/* Step Sublabel */}
                  <span className="text-[10px] text-[var(--text-muted)] line-clamp-1 max-w-[110px] mt-0.5">
                    {step.sublabel}
                  </span>

                  {/* Timestamp if available */}
                  {step.timestamp && (
                    <span className="text-[9px] font-mono text-zinc-500 mt-0.5">
                      {step.timestamp}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
