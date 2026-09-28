"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  MessagesSquare,
  Search,
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
  MoreHorizontal,
  Reply,
  Copy,
  Trash2,
  Check,
  Paperclip,
  Loader2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/components/ui/avatar";
import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/utils";

// ─── API shapes (mirror the route response) ───────────────────────────────────

type DbStatus =
  | "OPEN"
  | "AI_HANDLING"
  | "WAITING_FOR_CUSTOMER"
  | "WAITING_FOR_CLIENT"
  | "HUMAN_ESCALATION"
  | "RESOLVED"
  | "CLOSED";

type DbChannel = "WHATSAPP" | "EMAIL" | "WEB_CHAT" | "SMS";
type DbSender = "CUSTOMER" | "AI" | "EMPLOYEE";

interface ApiMessage {
  id: string;
  sender: DbSender;
  body: string;
  confidenceScore?: number | null;
  providerMessageId?: string | null;
  createdAt: string;
}

interface ApiConversation {
  id: string;
  channel: DbChannel;
  status: DbStatus;
  priority: string;
  subject: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  escalationReason: string | null;
  assignedEmployeeId: string | null;
  assignedEmployee: { id: string; name: string } | null;
  customer: {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    status: string;
  };
  // only present on the detail fetch
  messages?: ApiMessage[];
}

// ─── UI view types (kept from original for STATUS_CONFIG / rendering) ─────────

export type ConversationStatus =
  | "ai_handling"
  | "human_escalation"
  | "waiting_for_customer"
  | "waiting_for_client"
  | "open"
  | "resolved"
  | "closed";

export type ChannelType = "whatsapp" | "email" | "web_chat" | "sms";
export type OnlineStatus = "online" | "dnd" | "offline";

// ─── Normalisation: DB enum → UI enum ─────────────────────────────────────────

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
  };
  return map[c] ?? "whatsapp";
}

function dbSenderToType(s: DbSender): "customer" | "ai" | "agent" {
  if (s === "CUSTOMER") return "customer";
  if (s === "AI") return "ai";
  return "agent";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Static config (identical to original) ────────────────────────────────────

const STATUS_CONFIG: Record<
  ConversationStatus,
  { label: string; bg: string; text: string; icon: React.ElementType }
> = {
  open: {
    label: "Open",
    bg: "rgba(148,163,184,0.12)",
    text: "rgba(148,163,184,0.9)",
    icon: MessagesSquare,
  },
  ai_handling: {
    label: "AI Handling",
    bg: "rgba(96,165,250,0.12)",
    text: "var(--dash-chart-secondary)",
    icon: Bot,
  },
  human_escalation: {
    label: "Human Escalation",
    bg: "rgba(242,78,75,0.12)",
    text: "var(--dash-status-error)",
    icon: AlertTriangle,
  },
  waiting_for_customer: {
    label: "Waiting Customer",
    bg: "rgba(250,204,21,0.12)",
    text: "var(--dash-status-paused)",
    icon: Clock,
  },
  waiting_for_client: {
    label: "Waiting Client",
    bg: "rgba(250,204,21,0.12)",
    text: "var(--dash-status-paused)",
    icon: Clock,
  },
  resolved: {
    label: "Resolved",
    bg: "rgba(34,197,94,0.12)",
    text: "var(--dash-status-running)",
    icon: UserCheck,
  },
  closed: {
    label: "Closed",
    bg: "rgba(100,116,139,0.12)",
    text: "rgba(100,116,139,0.9)",
    icon: UserCheck,
  },
};

const CHANNEL_CONFIG: Record<
  ChannelType,
  { label: string; icon: React.ElementType; color: string }
> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "#22c55e" },
  email: { label: "Email", icon: Mail, color: "#60a5fa" },
  web_chat: { label: "Web Chat", icon: Globe, color: "#a855f7" },
  sms: { label: "SMS", icon: MessageCircle, color: "#f59e0b" },
};

const STATUS_COLORS: Record<OnlineStatus, string> = {
  online: "bg-emerald-500",
  dnd: "bg-rose-500",
  offline: "bg-zinc-500",
};

// ─── Small UI primitives ───────────────────────────────────────────────────────

function StatusBadge({
  status,
  className,
}: {
  status: OnlineStatus;
  className?: string;
}) {
  return (
    <span
      aria-label={status}
      className={cn(
        "inline-block size-2.5 rounded-full border-2 border-[var(--surface)] ring-1 ring-black/40 shrink-0",
        STATUS_COLORS[status],
        className,
      )}
      title={status.charAt(0).toUpperCase() + status.slice(1)}
    />
  );
}

// ─── UserActionsMenu — wired to PATCH /api/customer-conversations/:id ─────────

function UserActionsMenu({
  conversationId,
  currentStatus,
  onStatusChange,
}: {
  conversationId: string;
  currentStatus: DbStatus;
  onStatusChange: (next: DbStatus) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function patch(status: DbStatus) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/customer-conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        onStatusChange(status);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        console.error("[UserActionsMenu] PATCH failed", data.error);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="User actions"
          className="size-8 rounded-lg border border-white/10 bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
          disabled={busy}
          size="icon"
          type="button"
          variant="ghost"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreVertical aria-hidden="true" className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44 rounded-xl border border-white/10 bg-[#0d0f14] p-1.5 shadow-2xl backdrop-blur-xl text-xs"
      >
        <DropdownMenuItem
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] cursor-pointer"
          onClick={() =>
            patch(
              currentStatus === "AI_HANDLING"
                ? "HUMAN_ESCALATION"
                : "AI_HANDLING",
            )
          }
        >
          <Bot className="size-3.5 text-blue-400" />
          <span>
            {currentStatus === "AI_HANDLING"
              ? "Take over from AI"
              : "Hand back to AI"}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] cursor-pointer"
          onClick={() => patch("HUMAN_ESCALATION")}
        >
          <ShieldAlert className="size-3.5 text-amber-400" />
          <span>Escalate to Lead</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] cursor-pointer"
          onClick={() => patch("RESOLVED")}
        >
          <UserCheck className="size-3.5 text-emerald-400" />
          <span>Mark Resolved</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 bg-white/10" />
        <DropdownMenuItem
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
          onClick={() => patch("CLOSED")}
        >
          <Trash2 className="size-3.5" />
          <span>Close Conversation</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── MessageActions (copy only needs no API) ──────────────────────────────────

function MessageActions({
  content,
  isCustomer,
}: {
  content: string;
  isCustomer: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Message actions"
          className="size-6 rounded-md border border-white/10 bg-[#0c0d12]/90 hover:bg-white/10 text-white/50 hover:text-white transition-all shadow-sm"
          size="icon"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-36 rounded-xl border border-white/10 bg-[#0d0f14] p-1 shadow-2xl backdrop-blur-xl text-xs"
      >
        <DropdownMenuItem
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3 text-emerald-400" />
          ) : (
            <Copy className="size-3" />
          )}
          <span>{copied ? "Copied!" : "Copy Text"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
          // reply-quote is a future feature; copy is implemented
          onClick={handleCopy}
        >
          <Reply className="size-3" />
          <span>Reply Quote</span>
        </DropdownMenuItem>
        {!isCustomer && (
          <DropdownMenuItem className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer">
            <Trash2 className="size-3" />
            <span>Retract</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ConversationsPage() {
  // ── list state ──────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ── filter state ────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── active conversation state ────────────────────────────────────────────────
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<ApiConversation | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // ── reply box state ──────────────────────────────────────────────────────────
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── fetch conversation list ──────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter.toUpperCase());
      if (channelFilter !== "all") params.set("channel", channelFilter.toUpperCase());
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/customer-conversations?${params}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { conversations: ApiConversation[] };
      setConversations(data.conversations);

      // Auto-select first conversation on initial load
      setSelectedConvId((prev) =>
        prev ?? (data.conversations[0]?.id ?? null),
      );
    } catch {
      setListError("Failed to load conversations.");
    } finally {
      setListLoading(false);
    }
  }, [statusFilter, channelFilter, searchQuery]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  // ── fetch active conversation thread ────────────────────────────────────────
  useEffect(() => {
    if (!selectedConvId) return;
    setThreadLoading(true);
    setThreadError(null);
    fetch(`/api/customer-conversations/${selectedConvId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<{ conversation: ApiConversation }>;
      })
      .then(({ conversation }) => setActiveConv(conversation))
      .catch(() => setThreadError("Failed to load thread."))
      .finally(() => setThreadLoading(false));
  }, [selectedConvId]);

  // ── auto-scroll to latest message ───────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages]);

  // ── send reply ───────────────────────────────────────────────────────────────
  async function sendReply(markResolved = false) {
    if (!activeConv || !replyText.trim() || sending) return;
    const body = replyText.trim();
    setSending(true);
    setSendError(null);

    // Optimistic append
    const optimisticId = `opt_${Date.now()}`;
    const optimisticMsg: ApiMessage = {
      id: optimisticId,
      sender: "EMPLOYEE",
      body,
      createdAt: new Date().toISOString(),
    };
    setActiveConv((prev) =>
      prev
        ? { ...prev, messages: [...(prev.messages ?? []), optimisticMsg] }
        : prev,
    );
    setReplyText("");

    try {
      const res = await fetch(
        `/api/customer-conversations/${activeConv.id}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, markResolved }),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        message: ApiMessage;
        conversationStatus: DbStatus;
      };

      // Replace optimistic message with real one and update status
      setActiveConv((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: data.conversationStatus,
          messages: (prev.messages ?? []).map((m) =>
            m.id === optimisticId ? data.message : m,
          ),
          lastMessagePreview: body,
          lastMessageAt: data.message.createdAt,
        };
      });

      // Refresh list so status badge + preview update
      void fetchList();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      setSendError(msg);
      // Roll back optimistic message
      setActiveConv((prev) =>
        prev
          ? {
              ...prev,
              messages: (prev.messages ?? []).filter(
                (m) => m.id !== optimisticId,
              ),
            }
          : prev,
      );
      setReplyText(body);
    } finally {
      setSending(false);
    }
  }

  // ── status change callback from UserActionsMenu ───────────────────────────
  function handleStatusChange(next: DbStatus) {
    setActiveConv((prev) => (prev ? { ...prev, status: next } : prev));
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedConvId ? { ...c, status: next } : c,
      ),
    );
  }

  // ── client-side filter (search is server-driven, status/channel too, but
  //    we keep the instant UI feel by filtering the already-fetched list) ────
  const filteredConversations = conversations.filter((conv) => {
    const uiStatus = dbStatusToUi(conv.status);
    const uiChannel = dbChannelToUi(conv.channel);
    if (statusFilter !== "all" && uiStatus !== statusFilter) return false;
    if (channelFilter !== "all" && uiChannel !== channelFilter) return false;
    return true;
  });

  // ─── derived display values ────────────────────────────────────────────────
  const displayConv = activeConv;
  const displayStatus = displayConv ? dbStatusToUi(displayConv.status) : "open";
  const displayChannel = displayConv
    ? dbChannelToUi(displayConv.channel)
    : "whatsapp";
  const isClosed =
    displayConv?.status === "CLOSED" || displayConv?.status === "RESOLVED";

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 h-[calc(100vh-6rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 px-1">
        <div>
          <p className="dash-eyebrow">/ customer conversations</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
            Conversations & AI Hand-offs
          </h1>
        </div>
        <div className="flex items-center gap-2.5 text-xs font-mono text-[var(--text-muted)] bg-white/[0.02] border border-white/[0.07] px-3 py-1.5 rounded-xl shadow-xs backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-white/80">Real-time Omnichannel Feed</span>
        </div>
      </div>

      {/* Main Two-Column View */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        {/* ── Left Column: Filterable Conversation List ── */}
        <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/90 backdrop-blur-2xl overflow-hidden shadow-xl">
          {/* Search & Filters */}
          <div className="p-3.5 border-b border-white/[0.06] space-y-3 bg-white/[0.015]">
            <div className="relative flex items-center">
              <Search className="absolute left-3 size-3.5 text-white/40 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customers, companies, or keywords..."
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-12 py-2 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30 transition-all font-sans"
              />
              <kbd className="absolute right-2.5 pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border border-white/10 bg-white/[0.05] px-1.5 font-mono text-[10px] font-medium text-white/40">
                ⌘K
              </kbd>
            </div>

            {/* Channel pills */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-x-auto scrollbar-none text-[11px]">
              {[
                { id: "all", label: "All" },
                { id: "whatsapp", label: "WhatsApp" },
                { id: "email", label: "Email" },
                { id: "web_chat", label: "Web Chat" },
              ].map((pill) => {
                const isActive = channelFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    onClick={() => setChannelFilter(pill.id)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg font-medium transition-all shrink-0 cursor-pointer",
                      isActive
                        ? "bg-white/[0.12] text-white shadow-xs border border-white/10"
                        : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]",
                    )}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>

            {/* Status filter */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                Filter Status:
              </span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/80 focus:outline-none focus:border-red-500/40 cursor-pointer"
              >
                <option value="all" className="bg-[#0b0c10] text-white">
                  All Statuses
                </option>
                <option value="ai_handling" className="bg-[#0b0c10] text-white">
                  AI Handling
                </option>
                <option value="human_escalation" className="bg-[#0b0c10] text-white">
                  Human Escalation
                </option>
                <option value="waiting_for_customer" className="bg-[#0b0c10] text-white">
                  Waiting Customer
                </option>
                <option value="resolved" className="bg-[#0b0c10] text-white">
                  Resolved
                </option>
              </select>
            </div>
          </div>

          {/* List Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] scrollbar-thin scrollbar-thumb-white/10">
            {listLoading ? (
              <div className="flex items-center justify-center p-10 text-white/40">
                <Loader2 className="size-5 animate-spin mr-2" />
                <span className="text-xs">Loading conversations…</span>
              </div>
            ) : listError ? (
              <div className="p-8 text-center text-xs text-rose-400">{listError}</div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-white/40">
                No conversations match the selected filter.
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const uiStatus = dbStatusToUi(conv.status);
                const uiChannel = dbChannelToUi(conv.channel);
                const statusCfg =
                  STATUS_CONFIG[uiStatus] ?? STATUS_CONFIG.open;
                const channelCfg =
                  CHANNEL_CONFIG[uiChannel] ?? CHANNEL_CONFIG.whatsapp;
                const StatusIcon = statusCfg.icon;
                const ChannelIcon = channelCfg.icon;
                const isSelected = conv.id === selectedConvId;
                const initials = conv.customer.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("");

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={cn(
                      "p-3.5 cursor-pointer transition-all duration-150 relative group flex gap-3 items-start",
                      isSelected
                        ? "bg-white/[0.06] border-l-2 border-l-red-500 shadow-inner"
                        : "hover:bg-white/[0.03]",
                    )}
                  >
                    <div className="relative shrink-0 mt-0.5">
                      <Avatar className="size-9 rounded-full border border-white/10 bg-white/[0.05]">
                        <AvatarFallback className="text-[11px] font-bold text-white/80">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      {/* No real online-status from DB; render offline dot */}
                      <StatusBadge
                        status="offline"
                        className="absolute bottom-0 right-0 translate-x-0.5 translate-y-0.5"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="truncate text-xs font-semibold text-white/90 group-hover:text-white transition-colors">
                          {conv.customer.name}
                        </span>
                        <span
                          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider shrink-0"
                          style={{ background: statusCfg.bg, color: statusCfg.text }}
                        >
                          <StatusIcon className="size-2.5" />
                          {statusCfg.label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-white/40 mb-1.5">
                        <span className="flex items-center gap-1 truncate text-white/60">
                          <Building2 className="size-3 text-white/40" />
                          {conv.customer.company ?? "—"}
                        </span>
                        <span
                          className="flex items-center gap-1 text-[10px] font-mono"
                          style={{ color: channelCfg.color }}
                        >
                          <ChannelIcon className="size-2.5" />
                          {channelCfg.label}
                        </span>
                      </div>

                      <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">
                        {conv.lastMessagePreview ?? "(no messages yet)"}
                      </p>

                      <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-white/35">
                        <span>{relativeTime(conv.lastMessageAt)}</span>
                        {conv.assignedEmployee && (
                          <span className="truncate max-w-[120px]">
                            {conv.assignedEmployee.name.split(" ")[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right Column: Thread View ── */}
        <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/90 backdrop-blur-2xl overflow-hidden shadow-2xl">
          {!displayConv ? (
            <div className="flex-1 flex items-center justify-center text-xs text-white/30">
              {listLoading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                "Select a conversation to view the thread."
              )}
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="p-4 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.015] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Avatar className="size-10 rounded-full border border-white/10 bg-white/[0.05]">
                      <AvatarFallback className="text-xs font-bold text-white/90">
                        {displayConv.customer.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <StatusBadge
                      status="offline"
                      className="absolute bottom-0 right-0 translate-x-0.5 translate-y-0.5"
                    />
                  </div>
                  <div className="flex flex-col">
                    <h2 className="text-sm font-semibold text-white/95 flex items-center gap-2">
                      {displayConv.customer.name}
                      {displayConv.customer.company && (
                        <span className="text-xs font-normal text-white/40">
                          ({displayConv.customer.company})
                        </span>
                      )}
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-white/40 font-mono">
                      <span>
                        {displayConv.customer.email ??
                          displayConv.customer.whatsapp ??
                          displayConv.customer.phone ??
                          "—"}
                      </span>
                      <span>·</span>
                      <span className="capitalize">{displayChannel}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-mono font-medium border border-white/10"
                    style={{
                      background: STATUS_CONFIG[displayStatus].bg,
                      color: STATUS_CONFIG[displayStatus].text,
                    }}
                  >
                    {React.createElement(STATUS_CONFIG[displayStatus].icon, {
                      className: "size-3.5",
                    })}
                    {STATUS_CONFIG[displayStatus].label}
                  </span>
                  <UserActionsMenu
                    conversationId={displayConv.id}
                    currentStatus={displayConv.status}
                    onStatusChange={handleStatusChange}
                  />
                </div>
              </div>

              {/* Escalation Banner */}
              {displayConv.status === "HUMAN_ESCALATION" &&
                displayConv.escalationReason && (
                  <div className="p-3.5 bg-red-500/10 border-b border-red-500/20 text-xs space-y-2 shrink-0 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-red-400 font-semibold">
                      <span className="flex items-center gap-2">
                        <ShieldAlert className="size-4" />
                        AI Escalation Triggered
                      </span>
                      {displayConv.assignedEmployee && (
                        <span className="font-mono text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-md border border-red-500/30">
                          Assigned: {displayConv.assignedEmployee.name}
                        </span>
                      )}
                    </div>
                    <p className="text-white/90 font-medium">
                      Reason: {displayConv.escalationReason}
                    </p>
                  </div>
                )}

              {/* Messages Stream */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin scrollbar-thumb-white/10">
                {threadLoading ? (
                  <div className="flex items-center justify-center h-full text-white/40">
                    <Loader2 className="size-5 animate-spin mr-2" />
                    <span className="text-xs">Loading thread…</span>
                  </div>
                ) : threadError ? (
                  <div className="flex items-center justify-center h-full text-xs text-rose-400">
                    {threadError}
                  </div>
                ) : (
                  (displayConv.messages ?? []).map((msg) => {
                    const senderType = dbSenderToType(msg.sender);
                    const isCustomer = senderType === "customer";
                    const isAI = senderType === "ai";

                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          "group flex gap-3 max-w-2xl transition-all",
                          isCustomer
                            ? "justify-start"
                            : "ml-auto justify-end",
                        )}
                      >
                        <div
                          className={cn(
                            "flex max-w-[85%] items-start gap-2.5",
                            isCustomer ? "flex-row" : "flex-row-reverse",
                          )}
                        >
                          {/* Avatar */}
                          <Avatar className="size-8 rounded-full border border-white/10 bg-white/[0.05] shrink-0 mt-0.5">
                            {isCustomer ? (
                              <AvatarFallback className="text-[10px] font-bold text-white/80">
                                {displayConv.customer.name[0]}
                              </AvatarFallback>
                            ) : isAI ? (
                              <div className="w-full h-full bg-red-950/60 border border-red-500/40 flex items-center justify-center">
                                <Bot className="size-4 text-red-300" />
                              </div>
                            ) : (
                              <div className="w-full h-full bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-[10px] font-bold text-emerald-300">
                                AG
                              </div>
                            )}
                          </Avatar>

                          {/* Bubble */}
                          <div className="space-y-1 min-w-0">
                            <div
                              className={cn(
                                "rounded-2xl px-4 py-3 text-xs leading-relaxed transition-all shadow-md break-words",
                                isCustomer
                                  ? "bg-white/[0.04] border border-white/[0.08] text-white/90"
                                  : isAI
                                    ? "bg-red-950/25 border border-red-500/25 text-white/90"
                                    : "bg-white/[0.08] border border-white/15 text-white/95",
                              )}
                            >
                              {msg.body}
                            </div>

                            <div
                              className={cn(
                                "flex items-center gap-2 text-[10px] font-mono text-white/35 px-1.5",
                                isCustomer
                                  ? "justify-start"
                                  : "justify-end flex-row-reverse",
                              )}
                            >
                              <time dateTime={msg.createdAt}>
                                {formatTime(msg.createdAt)}
                              </time>
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <MessageActions
                                  content={msg.body}
                                  isCustomer={isCustomer}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply Box */}
              <div className="p-3.5 border-t border-white/[0.06] bg-white/[0.015] shrink-0">
                {sendError && (
                  <p className="text-[10px] text-rose-400 mb-1.5 px-1">
                    {sendError}
                  </p>
                )}
                {isClosed ? (
                  <p className="text-center text-xs text-white/30 py-2">
                    This conversation is {displayConv.status.toLowerCase()}.
                  </p>
                ) : (
                  <div className="relative flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Add attachment"
                      className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
                    >
                      <Paperclip className="size-4" />
                    </button>
                    <input
                      type="text"
                      value={replyText}
                      disabled={sending}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && replyText.trim()) {
                          e.preventDefault();
                          void sendReply(false);
                        }
                      }}
                      placeholder="Type response as agent (Enter to send)…"
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 pr-10 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-red-500/40 focus:ring-1 focus:ring-red-500/30 transition-all font-sans disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={!replyText.trim() || sending}
                      onClick={() => void sendReply(false)}
                      aria-label="Send reply"
                      className={cn(
                        "absolute right-2 p-1.5 rounded-lg transition-all",
                        replyText.trim() && !sending
                          ? "bg-red-500 text-white shadow-md hover:bg-red-600 cursor-pointer"
                          : "text-white/30 cursor-not-allowed",
                      )}
                    >
                      {sending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Send className="size-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
