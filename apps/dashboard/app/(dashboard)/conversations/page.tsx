"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  MessagesSquare,
  Search,
  ShoppingCart,
  AlertTriangle,
  Bot,
  UserCheck,
  Mail,
  MessageCircle,
  Globe,
  Clock,
  ShieldAlert,
  Send,
  Building2,
  MoreVertical,
  Reply,
  Copy,
  Check,
  Paperclip,
  Loader2,
  User,
  Users,
  ExternalLink,
  ChevronRight,
  X,
  FileText,
  DollarSign,
  TrendingUp,
  Sparkles,
  Settings,
  Plus,
  Package,
  Truck,
  CheckCircle2,
  Info,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/app/components/ui/avatar";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/utils";
import { useSession } from "@/app/providers/session-provider";
import { useOrgRealtime, type RealtimeEvent } from "@/app/lib/realtime/use-org-realtime";

// ─── Types ──────────────────────────────────────────────────────────────────

type DbStatus =
  | "OPEN"
  | "AI_HANDLING"
  | "WAITING_FOR_CUSTOMER"
  | "WAITING_FOR_CLIENT"
  | "HUMAN_ESCALATION"
  | "RESOLVED"
  | "CLOSED";

type DbChannel = "WHATSAPP" | "EMAIL" | "WEB_CHAT" | "SMS" | "DEMO";
type DbSender = "CUSTOMER" | "AI" | "EMPLOYEE";

interface ApiMessage {
  id: string;
  sender: DbSender;
  body: string;
  confidenceScore?: number | null;
  providerMessageId?: string | null;
  attachmentsJson?: string | null;
  emailSubject?: string | null;
  emailHeadersJson?: string | null;
  status?: string | null;
  createdAt: string;
}

interface ApiConversation {
  id: string;
  channel: DbChannel;
  status: DbStatus;
  priority: string;
  subject: string | null;
  aiIntent?: string | null;
  aiSummary?: string | null;
  aiContextJson?: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  escalationReason: string | null;
  assignedEmployeeId: string | null;
  assignedEmployee: { id: string; name: string; role?: string } | null;
  unreadCount?: number;
  customer: {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    status: string;
    taxId?: string | null;
    paymentTermsDays?: number | null;
  };
  messages?: ApiMessage[];
  orders?: Array<{
    id: string;
    draftNumber: string;
    orderNumber: string | null;
    status: string;
    totalMinor: number;
    currency: string;
    createdAt?: string;
    lines?: Array<{ sku: string; qty: number; rawText?: string }>;
  }>;
}

export type ConversationStatus =
  | "ai_handling"
  | "human_escalation"
  | "waiting_for_customer"
  | "waiting_for_client"
  | "open"
  | "resolved"
  | "closed";

export type ChannelType = "whatsapp" | "email" | "web_chat" | "sms" | "demo";
export type OnlineStatus = "online" | "dnd" | "offline";

function dbStatusToUi(s: DbStatus): ConversationStatus {
  const map: Record<DbStatus, ConversationStatus> = {
    OPEN: "open",
    AI_HANDLING: "ai_handling",
    WAITING_FOR_CUSTOMER: "waiting_for_customer",
    WAITING_FOR_CLIENT: "waiting_for_client",
    HUMAN_ESCALATION: "human_escalation",
    RESOLVED: "resolved",
    CLOSED: "closed",
  };
  return map[s] ?? "open";
}

function dbChannelToUi(c: DbChannel): ChannelType {
  const map: Record<DbChannel, ChannelType> = {
    WHATSAPP: "whatsapp",
    EMAIL: "email",
    WEB_CHAT: "web_chat",
    SMS: "sms",
    DEMO: "demo",
  };
  return map[c] ?? "whatsapp";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

const STATUS_CONFIG: Record<
  ConversationStatus,
  { label: string; bg: string; text: string; icon: React.ElementType }
> = {
  open: { label: "Open", bg: "rgba(148,163,184,0.12)", text: "rgba(148,163,184,0.9)", icon: MessagesSquare },
  ai_handling: { label: "AI Handling", bg: "rgba(96,165,250,0.12)", text: "var(--dash-chart-secondary)", icon: Bot },
  human_escalation: { label: "Escalated", bg: "rgba(242,78,75,0.12)", text: "var(--dash-status-error)", icon: AlertTriangle },
  waiting_for_customer: { label: "Waiting Customer", bg: "rgba(250,204,21,0.12)", text: "var(--dash-status-paused)", icon: Clock },
  waiting_for_client: { label: "Waiting Team", bg: "rgba(250,204,21,0.12)", text: "var(--dash-status-paused)", icon: Clock },
  resolved: { label: "Resolved", bg: "rgba(34,197,94,0.12)", text: "var(--dash-status-running)", icon: UserCheck },
  closed: { label: "Closed", bg: "rgba(100,116,139,0.12)", text: "rgba(100,116,139,0.9)", icon: UserCheck },
};

const CHANNEL_CONFIG: Record<
  ChannelType,
  { label: string; icon: React.ElementType; color: string }
> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "#22c55e" },
  email: { label: "Email", icon: Mail, color: "#60a5fa" },
  web_chat: { label: "Web Chat", icon: Globe, color: "#a855f7" },
  sms: { label: "SMS", icon: MessageCircle, color: "#f59e0b" },
  demo: { label: "Demo", icon: Sparkles, color: "#c084fc" },
};

const INTENT_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  NEW_ORDER: { label: "New Order", bg: "bg-emerald-500/15 border-emerald-500/30", text: "text-emerald-400" },
  ORDER_MODIFICATION: { label: "Order Change", bg: "bg-amber-500/15 border-amber-500/30", text: "text-amber-400" },
  ORDER_CANCELLATION: { label: "Cancellation", bg: "bg-rose-500/15 border-rose-500/30", text: "text-rose-400" },
  COMPLAINT: { label: "Complaint", bg: "bg-rose-500/20 border-rose-500/40", text: "text-rose-400" },
  DELIVERY_ENQUIRY: { label: "Delivery Tracking", bg: "bg-blue-500/15 border-blue-500/30", text: "text-blue-400" },
  PRODUCT_ENQUIRY: { label: "Product Enquiry", bg: "bg-purple-500/15 border-purple-500/30", text: "text-purple-400" },
  PAYMENT_ENQUIRY: { label: "Payment / Invoice", bg: "bg-teal-500/15 border-teal-500/30", text: "text-teal-400" },
  RETURN_OR_REFUND: { label: "Return / Refund", bg: "bg-orange-500/15 border-orange-500/30", text: "text-orange-400" },
  FOLLOW_UP: { label: "Follow Up", bg: "bg-sky-500/15 border-sky-500/30", text: "text-sky-400" },
  GENERAL_ENQUIRY: { label: "Enquiry", bg: "bg-slate-500/15 border-slate-500/30", text: "text-slate-300" },
  OTHER: { label: "General", bg: "bg-zinc-500/15 border-zinc-500/30", text: "text-zinc-400" },
};

// ─── Create Draft Order Modal ────────────────────────────────────────────────

interface CreateOrderModalProps {
  conversation: ApiConversation;
  onClose: () => void;
  onOrderCreated: (order: any) => void;
}

function CreateOrderModal({ conversation, onClose, onOrderCreated }: CreateOrderModalProps) {
  const [lines, setLines] = useState<Array<{ rawText: string; quantity: number }>>([]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prepopulate from AI context if available
  useEffect(() => {
    let populated = false;
    if (conversation.aiContextJson) {
      try {
        const ai = JSON.parse(conversation.aiContextJson);
        if (Array.isArray(ai.requestedQuantities) && ai.requestedQuantities.length > 0) {
          setLines(
            ai.requestedQuantities.map((rq: any) => ({
              rawText: `${rq.quantity} ${rq.unit || "boxes"} of ${rq.product}`,
              quantity: rq.quantity || 1,
            })),
          );
          if (ai.requestedDeliveryDate) setDeliveryDate(ai.requestedDeliveryDate);
          populated = true;
        }
      } catch {}
    }
    if (!populated) {
      setLines([
        {
          rawText: conversation.lastMessagePreview || "Standard Product Request",
          quantity: 10,
        },
      ]);
    }
  }, [conversation]);

  function addLine() {
    setLines((prev) => [...prev, { rawText: "", quantity: 1 }]);
  }

  function updateLine(index: number, field: "rawText" | "quantity", value: any) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)),
    );
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateOrder() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/customer-conversations/${conversation.id}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.filter((l) => l.rawText.trim().length > 0),
          deliveryDate: deliveryDate || undefined,
          deliveryAddress: deliveryAddress || undefined,
          instructions: instructions || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create draft order");
      }

      onOrderCreated(data.order);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0d0e12] p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <ShoppingCart className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Create Draft Order from Conversation</h2>
              <p className="text-[11px] text-white/50">Customer: {conversation.customer.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Order Items Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-white/80">Requested Order Items</label>
            <button
              type="button"
              onClick={addLine}
              className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
            >
              <Plus className="size-3" />
              <span>Add Line</span>
            </button>
          </div>

          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Product description / SKU..."
                  value={line.rawText}
                  onChange={(e) => updateLine(idx, "rawText", e.target.value)}
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50"
                />
                <input
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, "quantity", parseInt(e.target.value, 10) || 1)}
                  className="w-20 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white text-center focus:outline-none focus:border-red-500/50"
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    className="p-2 text-white/30 hover:text-rose-400 rounded-lg hover:bg-white/5"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-white/40 italic">
            Matched against your organization's active product catalog. Real prices, tax, and discount rules will be calculated automatically.
          </p>
        </div>

        {/* Delivery Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-white/70">Requested Delivery Date</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500/50 [color-scheme:dark]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-white/70">Delivery Address</label>
            <input
              type="text"
              placeholder="Shipping destination..."
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-white/70">Internal Notes / Instructions</label>
          <input
            type="text"
            placeholder="e.g. Expedited delivery requested by customer"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/10">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs text-white/60 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleCreateOrder}
            disabled={submitting}
            className="bg-red-500 hover:bg-red-600 text-white font-medium text-xs px-4"
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                <span>Creating Draft…</span>
              </>
            ) : (
              <span>Create Draft Order</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Unified Conversations Hub ──────────────────────────────────────────

export default function ConversationsPage() {
  const { session } = useSession();

  // Filters
  const [selectedTab, setSelectedTab] = useState<
    "all" | "whatsapp" | "email" | "unread" | "orders" | "enquiries" | "complaints" | "resolved"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Data states
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<ApiConversation | null>(null);

  // Loading states
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  // Reply state
  const [replyText, setReplyText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<{ name: string; url: string } | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  // Create Order Modal
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderCreatedNotice, setOrderCreatedNotice] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch Conversations List ────────────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });

      if (selectedTab === "whatsapp") params.set("channel", "WHATSAPP");
      else if (selectedTab === "email") params.set("channel", "EMAIL");
      else if (selectedTab === "orders") params.set("intent", "NEW_ORDER");
      else if (selectedTab === "complaints") params.set("intent", "COMPLAINT");
      else if (selectedTab === "enquiries") params.set("intent", "PRODUCT_ENQUIRY");
      else if (selectedTab === "resolved") params.set("status", "RESOLVED");

      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/customer-conversations?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let convs: ApiConversation[] = data.conversations || [];
      if (selectedTab === "unread") {
        convs = convs.filter((c) => (c.unreadCount || 0) > 0);
      }

      setConversations(convs);
      if (convs.length > 0 && !selectedConvId) {
        setSelectedConvId(convs[0].id);
      }
    } catch (err: any) {
      setListError("Failed to load conversations");
    } finally {
      setListLoading(false);
    }
  }, [selectedTab, searchQuery, selectedConvId]);

  // Realtime integration
  const onRealtimeEvent = useCallback((evt: RealtimeEvent) => {
    if (evt.name === "message:new") {
      void fetchConversations();
      if (activeConv && (evt.data as any)?.conversationId === activeConv.id) {
        fetch(`/api/customer-conversations/${activeConv.id}`)
          .then((res) => res.json())
          .then((d) => d.conversation && setActiveConv(d.conversation))
          .catch(() => {});
      }
    }
  }, [fetchConversations, activeConv]);

  const orgId = (session as any)?.organizationId || (session as any)?.organization?.id;
  const { live: realtimeLive } = useOrgRealtime(
    orgId,
    "messages",
    onRealtimeEvent,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchConversations();
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchConversations]);

  // ── Fetch Active Conversation Thread ─────────────────────────────────────────
  useEffect(() => {
    if (!selectedConvId) return;
    setThreadLoading(true);
    fetch(`/api/customer-conversations/${selectedConvId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.conversation) {
          setActiveConv(data.conversation);
          if (data.conversation.subject) {
            setEmailSubject(`Re: ${data.conversation.subject.replace(/^Re:\s*/i, "")}`);
          } else {
            setEmailSubject("Update regarding your inquiry");
          }
        }
      })
      .catch(() => {})
      .finally(() => setThreadLoading(false));
  }, [selectedConvId]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages]);

  // ── Send Outbound Reply ─────────────────────────────────────────────────────
  async function handleSendReply() {
    if ((!replyText.trim() && !attachment) || sending || !activeConv) return;
    setSending(true);
    try {
      const res = await fetch(`/api/customer-conversations/${activeConv.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: replyText.trim(),
          mediaUrl: attachment?.url,
          emailSubject: activeConv.channel === "EMAIL" ? emailSubject : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setReplyText("");
        setAttachment(null);
        // Refresh active thread
        const updated = await fetch(`/api/customer-conversations/${activeConv.id}`).then((r) => r.json());
        if (updated.conversation) setActiveConv(updated.conversation);
      }
    } finally {
      setSending(false);
    }
  }

  // ── Handle File Upload (S3) ──────────────────────────────────────────────────
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        setAttachment({ name: file.name, url: data.url });
      }
    } catch {} finally {
      setUploadingAttachment(false);
    }
  }

  const isEmail = activeConv?.channel === "EMAIL";
  const isWhatsApp = activeConv?.channel === "WHATSAPP";

  // Parse AI Understanding context if available
  let aiContext: any = null;
  if (activeConv?.aiContextJson) {
    try {
      aiContext = JSON.parse(activeConv.aiContextJson);
    } catch {}
  }

  return (
    <div className="mx-auto max-w-[1520px] space-y-3.5 h-[calc(100vh-5.5rem)] flex flex-col pb-2">
      {/* ── Top Header Bar ── */}
      <div className="flex items-center justify-between shrink-0 px-1">
        <div className="flex items-center gap-3">
          <div>
            <p className="dash-eyebrow">/ customer operations</p>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <span>Customer Conversations & Message-to-Order</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Integration Settings Link */}
          <Link
            href="/conversations/settings"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-xs text-white/80 transition-colors"
          >
            <Settings className="size-3.5 text-white/50" />
            <span>Channel Settings</span>
          </Link>

          {/* Realtime Live Status Badge */}
          <div className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] shadow-xs backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                  realtimeLive ? "bg-emerald-400" : "bg-amber-400",
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-2 w-2 rounded-full",
                  realtimeLive ? "bg-emerald-500" : "bg-amber-500",
                )}
              />
            </span>
            <span className="text-white/80">
              {realtimeLive ? "Realtime Connected" : "Omnichannel Connecting…"}
            </span>
          </div>
        </div>
      </div>

      {orderCreatedNotice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            <span>{orderCreatedNotice}</span>
          </div>
          <button onClick={() => setOrderCreatedNotice(null)} className="text-white/40 hover:text-white">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* ── Main Three-Panel Communication Workspace ── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[330px_1fr] xl:grid-cols-[330px_1fr_340px] gap-3.5">
        {/* ── LEFT PANEL: Filterable Conversation List ── */}
        <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/95 backdrop-blur-2xl overflow-hidden shadow-2xl">
          {/* Search bar */}
          <div className="p-3 border-b border-white/[0.06] space-y-2.5 bg-white/[0.015]">
            <div className="relative flex items-center">
              <Search className="absolute left-3 size-3.5 text-white/40 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customers, phone, email, messages..."
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 py-1.5 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-red-500/50 transition-all font-sans"
              />
            </div>

            {/* Filter pills */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none text-[11px] pb-0.5">
              {[
                { id: "all", label: "All" },
                { id: "whatsapp", label: "WhatsApp" },
                { id: "email", label: "Email" },
                { id: "orders", label: "Orders" },
                { id: "enquiries", label: "Enquiries" },
                { id: "complaints", label: "Complaints" },
                { id: "unread", label: "Unread" },
                { id: "resolved", label: "Resolved" },
              ].map((tab) => {
                const isActive = selectedTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedTab(tab.id as any)}
                    className={cn(
                      "px-2 py-1 rounded-lg font-medium transition-all shrink-0 cursor-pointer",
                      isActive
                        ? "bg-white/[0.12] text-white shadow-xs border border-white/10"
                        : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conversations list items */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] scrollbar-thin scrollbar-thumb-white/10">
            {listLoading ? (
              <div className="flex items-center justify-center p-10 text-white/40">
                <Loader2 className="size-5 animate-spin mr-2" />
                <span className="text-xs">Loading inbox…</span>
              </div>
            ) : listError ? (
              <div className="p-8 text-center text-xs text-rose-400">{listError}</div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-white/40">
                No conversations found in this view.
              </div>
            ) : (
              conversations.map((conv) => {
                const isSelected = conv.id === selectedConvId;
                const channelCfg = CHANNEL_CONFIG[dbChannelToUi(conv.channel)];
                const ChannelIcon = channelCfg?.icon || MessageCircle;
                const intentBadge = conv.aiIntent ? INTENT_BADGES[conv.aiIntent] : null;

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={cn(
                      "p-3 cursor-pointer transition-all duration-150 flex gap-2.5 items-start",
                      isSelected
                        ? "bg-white/[0.07] border-l-2 border-l-red-500 shadow-inner"
                        : "hover:bg-white/[0.03]",
                    )}
                  >
                    {/* Avatar with Channel Icon */}
                    <div className="relative shrink-0">
                      <Avatar className="size-9 rounded-xl border border-white/10 bg-white/5 text-white">
                        <AvatarFallback className="text-[11px] font-bold bg-white/5 text-white/90">
                          {conv.customer.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        className="absolute -bottom-1 -right-1 size-4 rounded-full flex items-center justify-center text-[9px] border border-black shadow"
                        style={{ backgroundColor: channelCfg?.color || "#22c55e", color: "#000" }}
                      >
                        <ChannelIcon className="size-2.5" />
                      </span>
                    </div>

                    {/* Content preview */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white truncate max-w-[150px]">
                          {conv.customer.name}
                        </span>
                        <span className="text-[10px] font-mono text-white/40">
                          {relativeTime(conv.lastMessageAt)}
                        </span>
                      </div>

                      {/* Last message preview */}
                      <p className="text-[11px] text-white/60 line-clamp-1 leading-tight">
                        {conv.lastMessagePreview || "No message preview"}
                      </p>

                      {/* Intent & status badges */}
                      <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                        {intentBadge && (
                          <span
                            className={cn(
                              "px-1.5 py-0.2 rounded text-[9px] font-medium border",
                              intentBadge.bg,
                              intentBadge.text,
                            )}
                          >
                            {intentBadge.label}
                          </span>
                        )}
                        {conv.unreadCount && conv.unreadCount > 0 ? (
                          <span className="ml-auto px-1.5 py-0.2 rounded-full bg-red-500 text-white font-mono text-[9px] font-bold">
                            {conv.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── CENTER PANEL: Message Thread & Composer ── */}
        <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/95 backdrop-blur-2xl overflow-hidden shadow-2xl">
          {!activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center text-white/30 p-8 space-y-3">
              <MessagesSquare className="size-12 stroke-[1.2]" />
              <p className="text-xs">Select a customer conversation from the left to start messaging.</p>
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="p-3.5 border-b border-white/[0.06] bg-white/[0.015] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <Avatar className="size-9 rounded-xl border border-white/10 bg-white/5">
                    <AvatarFallback className="text-xs font-bold text-white">
                      {activeConv.customer.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-white">{activeConv.customer.name}</h2>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1"
                        style={{
                          backgroundColor: isWhatsApp ? "rgba(34,197,94,0.1)" : "rgba(96,165,250,0.1)",
                          borderColor: isWhatsApp ? "rgba(34,197,94,0.3)" : "rgba(96,165,250,0.3)",
                          color: isWhatsApp ? "#4ade80" : "#93c5fd",
                        }}
                      >
                        {isWhatsApp ? <MessageCircle className="size-2.5" /> : <Mail className="size-2.5" />}
                        <span>{isWhatsApp ? "WhatsApp" : "Email"}</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-white/40 font-mono">
                      {isWhatsApp
                        ? activeConv.customer.whatsapp || activeConv.customer.phone || "No phone"
                        : activeConv.customer.email || "No email"}
                    </p>
                  </div>
                </div>

                {/* Header Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => setShowOrderModal(true)}
                    className="bg-red-500 hover:bg-red-600 text-white font-medium text-xs px-3 shadow-md flex items-center gap-1.5"
                  >
                    <ShoppingCart className="size-3.5" />
                    <span>Create Draft Order</span>
                  </Button>
                </div>
              </div>

              {/* Message Thread History */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-white/10">
                {threadLoading ? (
                  <div className="flex items-center justify-center py-20 text-white/40">
                    <Loader2 className="size-5 animate-spin mr-2" />
                    <span className="text-xs">Loading messages…</span>
                  </div>
                ) : (
                  activeConv.messages?.map((msg, idx) => {
                    const isCustomer = msg.sender === "CUSTOMER";
                    const isAi = msg.sender === "AI";
                    const isEmployee = msg.sender === "EMPLOYEE";

                    let attachments: any[] = [];
                    if (msg.attachmentsJson) {
                      try {
                        attachments = JSON.parse(msg.attachmentsJson);
                      } catch {}
                    }

                    return (
                      <div
                        key={msg.id || idx}
                        className={cn("flex flex-col", isCustomer ? "items-start" : "items-end")}
                      >
                        {/* Sender Label */}
                        <span className="text-[10px] font-mono text-white/40 px-1 mb-0.5">
                          {isCustomer
                            ? activeConv.customer.name
                            : isAi
                              ? "RF AI Assistant"
                              : "Operations Employee"}
                          {" · "}
                          {formatTime(msg.createdAt)}
                        </span>

                        {/* Bubble */}
                        <div
                          className={cn(
                            "max-w-[78%] rounded-2xl p-3 text-xs leading-relaxed space-y-1.5 shadow-md",
                            isCustomer
                              ? "bg-white/[0.06] border border-white/10 text-white/90 rounded-tl-sm"
                              : isAi
                                ? "bg-blue-950/40 border border-blue-500/20 text-blue-100 rounded-tr-sm"
                                : "bg-red-950/40 border border-red-500/30 text-white rounded-tr-sm",
                          )}
                        >
                          {/* Email subject if present */}
                          {msg.emailSubject && (
                            <div className="text-[10px] font-mono text-white/50 border-b border-white/10 pb-1">
                              Subject: {msg.emailSubject}
                            </div>
                          )}

                          {/* Message Body */}
                          <p className="whitespace-pre-wrap">{msg.body}</p>

                          {/* Attachments */}
                          {attachments.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-white/10">
                              {attachments.map((att, aIdx) => (
                                <a
                                  key={aIdx}
                                  href={att.url || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:underline"
                                >
                                  <Paperclip className="size-3" />
                                  <span>{att.filename || att.name || "Attachment"}</span>
                                </a>
                              ))}
                            </div>
                          )}

                          {/* Status Indicator */}
                          {!isCustomer && (
                            <div className="text-[9px] font-mono text-white/40 text-right flex items-center justify-end gap-1 pt-0.5">
                              <span>{msg.status || "delivered"}</span>
                              <CheckCircle2 className="size-2.5 text-white/50" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* ── Channel Composer ── */}
              <div className="p-3 border-t border-white/[0.06] bg-white/[0.015] space-y-2">
                {/* Channel constraints notice */}
                {isWhatsApp ? (
                  <div className="flex items-center justify-between text-[10px] text-emerald-400/80 font-mono px-1">
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>WhatsApp Cloud API — 24h Customer Service Window Active</span>
                    </span>
                    <span>Direct text & media enabled</span>
                  </div>
                ) : isEmail ? (
                  <div className="space-y-1.5 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-white/40 w-12">Subject:</span>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        placeholder="Email subject..."
                        className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50"
                      />
                    </div>
                  </div>
                ) : null}

                {/* Attachment tag */}
                {attachment && (
                  <div className="p-2 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-white/80">
                      <Paperclip className="size-3.5 text-blue-400" />
                      <span className="truncate max-w-[200px]">{attachment.name}</span>
                    </div>
                    <button onClick={() => setAttachment(null)} className="text-white/40 hover:text-white">
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}

                {/* Input row */}
                <div className="relative flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileSelected}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={uploadingAttachment}
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
                    title="Attach file or invoice"
                  >
                    {uploadingAttachment ? (
                      <Loader2 className="size-4 animate-spin text-blue-400" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                  </button>

                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendReply();
                      }
                    }}
                    placeholder={
                      isWhatsApp
                        ? "Type official WhatsApp reply (Enter to send)..."
                        : "Type email response (Enter to send)..."
                    }
                    className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 pr-10 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-red-500/40"
                  />

                  <button
                    type="button"
                    disabled={(!replyText.trim() && !attachment) || sending}
                    onClick={() => void handleSendReply()}
                    className={cn(
                      "absolute right-2 p-1.5 rounded-lg transition-all",
                      (replyText.trim() || attachment) && !sending
                        ? "bg-red-500 text-white shadow-md hover:bg-red-600 cursor-pointer"
                        : "text-white/30 cursor-not-allowed",
                    )}
                  >
                    {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT PANEL: AI & Customer Business Context ── */}
        {activeConv && (
          <div className="hidden xl:flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/95 backdrop-blur-2xl p-4 overflow-y-auto space-y-4 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-red-400" />
                <span>AI Context & Orders</span>
              </h3>
              <Link
                href={`/customers/${activeConv.customer.id}`}
                className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
              >
                <span>Profile</span>
                <ExternalLink className="size-3" />
              </Link>
            </div>

            {/* AI Understanding Section */}
            <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                  Detected Intent
                </span>
                {activeConv.aiIntent && INTENT_BADGES[activeConv.aiIntent] && (
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-semibold border",
                      INTENT_BADGES[activeConv.aiIntent].bg,
                      INTENT_BADGES[activeConv.aiIntent].text,
                    )}
                  >
                    {INTENT_BADGES[activeConv.aiIntent].label}
                  </span>
                )}
              </div>

              {/* AI Summary */}
              {activeConv.aiSummary && (
                <div className="space-y-1">
                  <span className="text-[10px] text-white/40 block">Summary</span>
                  <p className="text-xs text-white/90 leading-relaxed font-sans">
                    {activeConv.aiSummary}
                  </p>
                </div>
              )}

              {/* Mentioned Products / Quantities */}
              {aiContext?.requestedQuantities && aiContext.requestedQuantities.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <span className="text-[10px] text-white/40 block">Extracted Items</span>
                  <div className="space-y-1">
                    {aiContext.requestedQuantities.map((rq: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-white/[0.03] border border-white/5"
                      >
                        <span className="text-white/80 font-medium">{rq.product}</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {rq.quantity} {rq.unit || "boxes"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Urgency & Recommended Action */}
              {aiContext?.recommendedAction && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-red-300 font-semibold uppercase">Recommended Action</span>
                    {aiContext.urgency && (
                      <span className="font-mono text-amber-300">Urgency: {aiContext.urgency}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/90 leading-snug">
                    {aiContext.recommendedAction}
                  </p>
                </div>
              )}
            </div>

            {/* Customer Details */}
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">
                Customer Details
              </span>
              <div className="space-y-1">
                <span className="font-bold text-white block">{activeConv.customer.name}</span>
                {activeConv.customer.company && (
                  <div className="flex items-center gap-1.5 text-white/60">
                    <Building2 className="size-3 text-white/40" />
                    <span>{activeConv.customer.company}</span>
                  </div>
                )}
                {activeConv.customer.taxId && (
                  <div className="text-[10px] font-mono text-white/40">
                    GSTIN: {activeConv.customer.taxId}
                  </div>
                )}
                <div className="pt-1.5 border-t border-white/5 flex justify-between text-[11px]">
                  <span className="text-white/40">Payment Terms:</span>
                  <span className="font-mono text-blue-400">
                    {activeConv.customer.paymentTermsDays
                      ? `Net ${activeConv.customer.paymentTermsDays}`
                      : "Immediate"}
                  </span>
                </div>
              </div>
            </div>

            {/* Related Orders */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">
                  Related Orders ({activeConv.orders?.length || 0})
                </span>
                <button
                  onClick={() => setShowOrderModal(true)}
                  className="text-[10px] font-semibold text-red-400 hover:text-red-300 flex items-center gap-1"
                >
                  <Plus className="size-3" />
                  <span>New Draft</span>
                </button>
              </div>

              {!activeConv.orders || activeConv.orders.length === 0 ? (
                <div className="p-4 text-center rounded-xl border border-white/5 bg-white/[0.01] text-xs text-white/40">
                  No orders created yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeConv.orders.map((o) => (
                    <Link
                      key={o.id}
                      href={`/orders/${o.id}`}
                      className="p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 block text-xs space-y-1.5 transition-all"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <span className="font-bold text-white hover:text-red-400">
                          {o.orderNumber || o.draftNumber}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-white/80 uppercase font-semibold">
                          {o.status}
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] text-white/50">
                        <span>Total:</span>
                        <span className="font-mono text-white font-bold">
                          ₹{((o.totalMinor || 0) / 100).toFixed(2)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showOrderModal && activeConv && (
        <CreateOrderModal
          conversation={activeConv}
          onClose={() => setShowOrderModal(false)}
          onOrderCreated={(order) => {
            setOrderCreatedNotice(`Draft order ${order.draftNumber} created successfully!`);
            // Refresh conversation to show linked order
            fetch(`/api/customer-conversations/${activeConv.id}`)
              .then((r) => r.json())
              .then((d) => d.conversation && setActiveConv(d.conversation));
          }}
        />
      )}
    </div>
  );
}
