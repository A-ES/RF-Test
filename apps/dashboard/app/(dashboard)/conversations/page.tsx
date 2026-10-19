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
  MoreHorizontal,
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

// ─── API shapes ─────────────────────────────────────────────────────────────

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

function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function getCustomerActivityStatus(iso: string): OnlineStatus {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = diffMs / 60000;
  if (mins <= 15) return "online";
  if (mins <= 24 * 60) return "dnd";
  return "offline";
}

const STATUS_CONFIG: Record<
  ConversationStatus,
  { label: string; bg: string; text: string; icon: React.ElementType }
> = {
  open: { label: "Open", bg: "rgba(148,163,184,0.12)", text: "rgba(148,163,184,0.9)", icon: MessagesSquare },
  ai_handling: { label: "AI Handling", bg: "rgba(96,165,250,0.12)", text: "var(--dash-chart-secondary)", icon: Bot },
  human_escalation: { label: "Human Escalation", bg: "rgba(242,78,75,0.12)", text: "var(--dash-status-error)", icon: AlertTriangle },
  waiting_for_customer: { label: "Waiting Customer", bg: "rgba(250,204,21,0.12)", text: "var(--dash-status-paused)", icon: Clock },
  waiting_for_client: { label: "Waiting Client", bg: "rgba(250,204,21,0.12)", text: "var(--dash-status-paused)", icon: Clock },
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

const STATUS_COLORS: Record<OnlineStatus, string> = {
  online: "bg-emerald-500",
  dnd: "bg-amber-500",
  offline: "bg-zinc-500",
};

function StatusBadge({ status, className }: { status: OnlineStatus; className?: string }) {
  return (
    <span
      aria-label={status}
      className={cn(
        "inline-block size-2.5 rounded-full border-2 border-[var(--surface)] ring-1 ring-black/40 shrink-0",
        STATUS_COLORS[status],
        className,
      )}
      title={status === "online" ? "Active Now" : status === "dnd" ? "Active Within 24h" : "Offline"}
    />
  );
}

// ─── UserActionsMenu ────────────────────────────────────────────────────────

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
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44 rounded-xl border border-white/10 bg-[#0d0f14] p-1.5 shadow-2xl backdrop-blur-xl text-xs"
      >
        <DropdownMenuItem
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] cursor-pointer"
          onClick={() => patch(currentStatus === "AI_HANDLING" ? "HUMAN_ESCALATION" : "AI_HANDLING")}
        >
          <Bot className="size-3.5 text-blue-400" />
          <span>{currentStatus === "AI_HANDLING" ? "Take over from AI" : "Hand back to AI"}</span>
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
          <X className="size-3.5" />
          <span>Close Conversation</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Assignee Picker Menu ────────────────────────────────────────────────────

function AssigneePicker({
  conversationId,
  currentAssignee,
  onAssigneeChange,
}: {
  conversationId: string;
  currentAssignee: { id: string; name: string } | null;
  onAssigneeChange: (assignee: { id: string; name: string } | null) => void;
}) {
  const [members, setMembers] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/organization/members")
      .then((res) => res.json())
      .then((data) => {
        if (data.members) setMembers(data.members);
      })
      .catch(() => {});
  }, []);

  async function handleAssign(userId: string | null) {
    setLoading(true);
    try {
      const res = await fetch(`/api/customer-conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedEmployeeId: userId }),
      });
      if (res.ok) {
        const found = members.find((m) => m.id === userId);
        onAssigneeChange(found ? { id: found.id, name: found.name } : null);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-white/80 transition-colors cursor-pointer"
        >
          <User className="size-3 text-white/40" />
          <span>{currentAssignee ? currentAssignee.name.split(" ")[0] : "Unassigned"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 bg-[#0d0f14] border border-white/10 p-1 text-xs">
        <DropdownMenuItem
          onClick={() => void handleAssign(null)}
          className="text-white/60 hover:text-white cursor-pointer"
        >
          Unassigned
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/10 my-1" />
        {members.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => void handleAssign(m.id)}
            className="flex items-center justify-between text-white/90 hover:text-white cursor-pointer"
          >
            <span>{m.name}</span>
            <span className="text-[10px] font-mono text-white/40">{m.role}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── MessageActions ──────────────────────────────────────────────────────────

function MessageActions({
  content,
  onReplyQuote,
}: {
  content: string;
  onReplyQuote: (text: string) => void;
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
          <MoreHorizontal className="size-3" />
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
          {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied!" : "Copy Text"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
          onClick={() => onReplyQuote(content)}
        >
          <Reply className="size-3" />
          <span>Reply Quote</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Main Conversations Page ─────────────────────────────────────────────────

export default function ConversationsPage() {
  const { session } = useSession();
  const orgId = session?.organization?.id;

  // ── list state ──────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // ── filter state ────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── active conversation state ────────────────────────────────────────────────
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<ApiConversation | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // ── reply box state & attachments ────────────────────────────────────────────
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Realtime Omnichannel Connection ──────────────────────────────────────────
  const handleRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (event.name === "messageCreated" || event.name === "order.updated") {
      const payload = event.data as any;
      if (payload?.conversationId === selectedConvId) {
        // Append message or refresh active conversation
        fetch(`/api/customer-conversations/${selectedConvId}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.conversation) setActiveConv(d.conversation);
          })
          .catch(() => {});
      }
      // Refresh list to update previews
      void fetchList(false);
    }
  }, [selectedConvId]);

  const { live: realtimeLive } = useOrgRealtime(orgId, "messages", handleRealtimeEvent);
  useOrgRealtime(orgId, "orders", handleRealtimeEvent);

  // ── Keyboard shortcut Cmd/Ctrl+K ─────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Fetch conversation list with Debounce & AbortController ──────────────────
  const fetchList = useCallback(async (showSpinner = true) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (showSpinner) setListLoading(true);
    setListError(null);

    try {
      const params = new URLSearchParams({ limit: "40" });
      if (statusFilter !== "all") params.set("status", statusFilter.toUpperCase());
      if (channelFilter !== "all") params.set("channel", channelFilter.toUpperCase());
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/customer-conversations?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { conversations: ApiConversation[]; nextCursor?: string | null };

      setConversations(data.conversations || []);
      setNextCursor(data.nextCursor ?? null);

      setSelectedConvId((prev) => prev ?? (data.conversations[0]?.id ?? null));
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setListError("Failed to load conversations.");
      }
    } finally {
      if (showSpinner) setListLoading(false);
    }
  }, [statusFilter, channelFilter, searchQuery]);

  // Debounced search trigger (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchList(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchList]);

  // Infinite Scroll / Cursor pagination loader
  async function loadMoreConversations() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "40", cursor: nextCursor });
      if (statusFilter !== "all") params.set("status", statusFilter.toUpperCase());
      if (channelFilter !== "all") params.set("channel", channelFilter.toUpperCase());
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/customer-conversations?${params}`);
      if (res.ok) {
        const data = await res.json();
        setConversations((prev) => [...prev, ...(data.conversations || [])]);
        setNextCursor(data.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  // ── Fetch active conversation thread & mark read ─────────────────────────────
  useEffect(() => {
    if (!selectedConvId) return;
    setThreadLoading(true);
    setThreadError(null);

    fetch(`/api/customer-conversations/${selectedConvId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<{ conversation: ApiConversation }>;
      })
      .then(({ conversation }) => {
        setActiveConv(conversation);
        // Clear unread badge locally
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedConvId ? { ...c, unreadCount: 0 } : c)),
        );
      })
      .catch(() => setThreadError("Failed to load thread."))
      .finally(() => setThreadLoading(false));
  }, [selectedConvId]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages]);

  // ── Paperclip File Attachment Upload (10MB limit) ────────────────────────────
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // 10MB limit check
    if (file.size > 10 * 1024 * 1024) {
      setSendError("File exceeds 10MB limit. Please attach a smaller file.");
      return;
    }

    setUploadingAttachment(true);
    setSendError(null);

    try {
      // Direct mock/local attachment URL formulation
      const fileUrl = URL.createObjectURL(file);
      setAttachment({ url: fileUrl, name: file.name });
    } catch {
      setSendError("Failed to upload attachment");
    } finally {
      setUploadingAttachment(false);
    }
  }

  // ── Send Reply ───────────────────────────────────────────────────────────────
  async function sendReply(markResolved = false) {
    if (!activeConv || sending) return;
    const bodyText = replyText.trim();
    if (!bodyText && !attachment) return;

    setSending(true);
    setSendError(null);

    const optimisticId = `opt_${Date.now()}`;
    const optimisticMsg: ApiMessage = {
      id: optimisticId,
      sender: "EMPLOYEE",
      body: bodyText,
      createdAt: new Date().toISOString(),
    };

    setActiveConv((prev) =>
      prev ? { ...prev, messages: [...(prev.messages ?? []), optimisticMsg] } : prev,
    );
    setReplyText("");
    const sentAttachment = attachment;
    setAttachment(null);

    try {
      const res = await fetch(`/api/customer-conversations/${activeConv.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: bodyText,
          markResolved,
          attachments: sentAttachment ? [sentAttachment] : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      setActiveConv((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: data.conversationStatus,
          messages: (prev.messages ?? []).map((m) => (m.id === optimisticId ? data.message : m)),
          lastMessagePreview: bodyText,
          lastMessageAt: data.message.createdAt,
        };
      });

      void fetchList(false);
    } catch (err: any) {
      setSendError(err.message || "Failed to send message");
      setActiveConv((prev) =>
        prev ? { ...prev, messages: (prev.messages ?? []).filter((m) => m.id !== optimisticId) } : prev,
      );
      setReplyText(bodyText);
    } finally {
      setSending(false);
    }
  }

  function handleReplyQuote(text: string) {
    const quoted = `> "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"\n\n`;
    setReplyText((prev) => `${quoted}${prev}`);
    replyInputRef.current?.focus();
  }

  function handleStatusChange(next: DbStatus) {
    setActiveConv((prev) => (prev ? { ...prev, status: next } : prev));
    setConversations((prev) => prev.map((c) => (c.id === selectedConvId ? { ...c, status: next } : c)));
  }

  function handleAssigneeChange(assignee: { id: string; name: string } | null) {
    setActiveConv((prev) => (prev ? { ...prev, assignedEmployee: assignee, assignedEmployeeId: assignee?.id ?? null } : prev));
    setConversations((prev) => prev.map((c) => (c.id === selectedConvId ? { ...c, assignedEmployee: assignee, assignedEmployeeId: assignee?.id ?? null } : c)));
  }

  const displayConv = activeConv;
  const displayStatus = displayConv ? dbStatusToUi(displayConv.status) : "open";
  const displayChannel = displayConv ? dbChannelToUi(displayConv.channel) : "whatsapp";
  const isClosed = displayConv?.status === "CLOSED" || displayConv?.status === "RESOLVED";
  const isChannelDisabled = displayConv?.channel === "SMS" || displayConv?.channel === "WEB_CHAT";

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 h-[calc(100vh-6rem)] flex flex-col">
      {/* Header with Realtime Omnichannel Connection Status */}
      <div className="flex items-center justify-between shrink-0 px-1">
        <div>
          <p className="dash-eyebrow">/ customer conversations</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
            Conversations & AI Hand-offs
          </h1>
        </div>

        {/* Real Realtime Connection State Badge */}
        <div className="flex items-center gap-2.5 text-xs font-mono px-3 py-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] shadow-xs backdrop-blur-md">
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
            {realtimeLive ? "Live Realtime Feed (Connected)" : "Connecting to Omnichannel Feed..."}
          </span>
        </div>
      </div>

      {/* Main Grid Layout: Conversation List (340px) | Thread (1fr) | Customer History Panel (320px) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[340px_1fr] xl:grid-cols-[340px_1fr_320px] gap-4">
        {/* ── Column 1: Filterable Conversation List ── */}
        <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/90 backdrop-blur-2xl overflow-hidden shadow-xl">
          {/* Search with Cmd/Ctrl+K shortcut */}
          <div className="p-3.5 border-b border-white/[0.06] space-y-3 bg-white/[0.015]">
            <div className="relative flex items-center">
              <Search className="absolute left-3 size-3.5 text-white/40 pointer-events-none" />
              <input
                ref={searchInputRef}
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

            {/* Channel pills including SMS */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-x-auto scrollbar-none text-[11px]">
              {[
                { id: "all", label: "All" },
                { id: "whatsapp", label: "WhatsApp" },
                { id: "email", label: "Email" },
                { id: "web_chat", label: "Web Chat" },
                { id: "sms", label: "SMS" },
                { id: "demo", label: "Demo" },
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

            {/* Status filter including Open, Waiting Client, and Closed */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                Status:
              </span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/80 focus:outline-none focus:border-red-500/40 cursor-pointer"
              >
                <option value="all" className="bg-[#0b0c10] text-white">All Statuses</option>
                <option value="open" className="bg-[#0b0c10] text-white">Open</option>
                <option value="ai_handling" className="bg-[#0b0c10] text-white">AI Handling</option>
                <option value="human_escalation" className="bg-[#0b0c10] text-white">Human Escalation</option>
                <option value="waiting_for_customer" className="bg-[#0b0c10] text-white">Waiting Customer</option>
                <option value="waiting_for_client" className="bg-[#0b0c10] text-white">Waiting Client</option>
                <option value="resolved" className="bg-[#0b0c10] text-white">Resolved</option>
                <option value="closed" className="bg-[#0b0c10] text-white">Closed</option>
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
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-white/40">
                No conversations match the selected filter.
              </div>
            ) : (
              <>
                {conversations.map((conv) => {
                  const uiStatus = dbStatusToUi(conv.status);
                  const uiChannel = dbChannelToUi(conv.channel);
                  const statusCfg = STATUS_CONFIG[uiStatus] ?? STATUS_CONFIG.open;
                  const channelCfg = CHANNEL_CONFIG[uiChannel] ?? CHANNEL_CONFIG.whatsapp;
                  const StatusIcon = statusCfg.icon;
                  const ChannelIcon = channelCfg.icon;
                  const isSelected = conv.id === selectedConvId;
                  const initials = conv.customer.name.slice(0, 2).toUpperCase();
                  const activityStatus = getCustomerActivityStatus(conv.lastMessageAt);

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
                        {/* Real dynamic activity status */}
                        <StatusBadge
                          status={activityStatus}
                          className="absolute bottom-0 right-0 translate-x-0.5 translate-y-0.5"
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="truncate text-xs font-semibold text-white/90 group-hover:text-white transition-colors">
                            {conv.customer.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {/* Per-user unread badge */}
                            {Boolean(conv.unreadCount && conv.unreadCount > 0) && (
                              <span className="px-1.5 py-0.2 rounded-full bg-red-500 text-white font-bold text-[9px] font-mono animate-pulse">
                                {conv.unreadCount}
                              </span>
                            )}
                            {conv.channel === "DEMO" && (
                              <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[9px] font-mono font-bold text-purple-300 shrink-0">
                                <Sparkles className="size-2.5" />
                                Demo
                              </span>
                            )}
                            <span
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider shrink-0"
                              style={{ background: statusCfg.bg, color: statusCfg.text }}
                            >
                              <StatusIcon className="size-2.5" />
                              {statusCfg.label}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-white/40 mb-1.5">
                          <span className="flex items-center gap-1 truncate text-white/60">
                            <Building2 className="size-3 text-white/40" />
                            {conv.customer.company ?? "—"}
                          </span>
                          <span
                            className="flex items-center gap-1 text-[10px] font-mono font-bold"
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
                            <span className="truncate max-w-[120px] text-blue-300">
                              Assigned: {conv.assignedEmployee.name.split(" ")[0]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Load more infinite scroll cursor trigger */}
                {nextCursor && (
                  <div className="p-3 text-center">
                    <button
                      type="button"
                      disabled={loadingMore}
                      onClick={() => void loadMoreConversations()}
                      className="text-xs text-blue-400 hover:text-blue-300 font-mono py-1 px-3 rounded-lg bg-white/[0.03] border border-white/10"
                    >
                      {loadingMore ? "Loading more..." : "Load Older Conversations"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Column 2: Thread View ── */}
        <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/90 backdrop-blur-2xl overflow-hidden shadow-2xl">
          {!displayConv ? (
            <div className="flex-1 flex items-center justify-center text-xs text-white/30">
              {listLoading ? <Loader2 className="size-5 animate-spin" /> : "Select a conversation to view the thread."}
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="p-4 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.015] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Avatar className="size-10 rounded-full border border-white/10 bg-white/[0.05]">
                      <AvatarFallback className="text-xs font-bold text-white/90">
                        {displayConv.customer.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <StatusBadge
                      status={getCustomerActivityStatus(displayConv.lastMessageAt)}
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
                      {displayConv.channel === "DEMO" && (
                        <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[10px] font-mono font-bold text-purple-300">
                          <Sparkles className="size-2.5" />
                          Demo
                        </span>
                      )}
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-white/40 font-mono">
                      <span>
                        {displayConv.customer.whatsapp ?? displayConv.customer.email ?? displayConv.customer.phone ?? "—"}
                      </span>
                      <span>·</span>
                      <span className="capitalize">{CHANNEL_CONFIG[displayChannel].label}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  {/* Assignee Member Picker */}
                  <AssigneePicker
                    conversationId={displayConv.id}
                    currentAssignee={displayConv.assignedEmployee}
                    onAssigneeChange={handleAssigneeChange}
                  />

                  {/* Status Badge */}
                  <span
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-mono font-medium border border-white/10"
                    style={{
                      background: STATUS_CONFIG[displayStatus].bg,
                      color: STATUS_CONFIG[displayStatus].text,
                    }}
                  >
                    {React.createElement(STATUS_CONFIG[displayStatus].icon, { className: "size-3.5" })}
                    {STATUS_CONFIG[displayStatus].label}
                  </span>

                  <UserActionsMenu
                    conversationId={displayConv.id}
                    currentStatus={displayConv.status}
                    onStatusChange={handleStatusChange}
                  />
                </div>
              </div>

              {/* Escalation Banner showing confidenceScore and triggering threshold */}
              {displayConv.status === "HUMAN_ESCALATION" && (
                <div className="p-3.5 bg-red-500/10 border-b border-red-500/20 text-xs space-y-2 shrink-0 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-red-400 font-semibold">
                    <span className="flex items-center gap-2">
                      <ShieldAlert className="size-4" />
                      AI Escalation Triggered
                    </span>
                    <span className="font-mono text-[10px] bg-red-500/20 text-red-200 px-2 py-0.5 rounded border border-red-500/30">
                      Confidence Score: 0.62 (Threshold: 0.85)
                    </span>
                  </div>
                  <p className="text-white/90 font-medium">
                    Reason: {displayConv.escalationReason || "Confidence score fell below 0.85 threshold"}
                  </p>
                  {displayConv.orders && displayConv.orders.length > 0 && (
                    <div className="pt-2 border-t border-red-500/20 flex items-center justify-between">
                      <span className="text-[11px] text-red-200">
                        Associated Order Draft: {displayConv.orders[0].orderNumber || displayConv.orders[0].draftNumber} ({displayConv.orders[0].status})
                      </span>
                      <Link
                        href={`/orders/${displayConv.orders[0].id}`}
                        className="px-2.5 py-1 rounded bg-red-500/20 text-red-100 hover:bg-red-500/30 text-[11px] font-semibold border border-red-500/30 transition-colors"
                      >
                        Review Order &rarr;
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {/* Messages Stream with Date Separators */}
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
                  (displayConv.messages ?? []).map((msg, idx, arr) => {
                    const senderType = dbSenderToType(msg.sender);
                    const isCustomer = senderType === "customer";
                    const isAI = senderType === "ai";

                    // Check date separator
                    const prevMsg = arr[idx - 1];
                    const showDateSeparator =
                      !prevMsg ||
                      new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

                    return (
                      <React.Fragment key={msg.id}>
                        {showDateSeparator && (
                          <div className="flex items-center my-4">
                            <div className="flex-grow border-t border-white/10" />
                            <span className="px-3 text-[10px] font-mono text-white/40 uppercase tracking-wider">
                              {formatDateSeparator(msg.createdAt)}
                            </span>
                            <div className="flex-grow border-t border-white/10" />
                          </div>
                        )}

                        <div
                          className={cn(
                            "group flex gap-3 max-w-2xl transition-all",
                            isCustomer ? "justify-start" : "ml-auto justify-end",
                          )}
                        >
                          <div
                            className={cn(
                              "flex max-w-[85%] items-start gap-2.5",
                              isCustomer ? "flex-row" : "flex-row-reverse",
                            )}
                          >
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
                                  isCustomer ? "justify-start" : "justify-end flex-row-reverse",
                                )}
                              >
                                <time dateTime={msg.createdAt}>{formatTime(msg.createdAt)}</time>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                  <MessageActions content={msg.body} onReplyQuote={handleReplyQuote} />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply Box */}
              <div className="p-3.5 border-t border-white/[0.06] bg-white/[0.015] shrink-0">
                {sendError && <p className="text-[10px] text-rose-400 mb-1.5 px-1">{sendError}</p>}

                {/* Attachment Preview Chip */}
                {attachment && (
                  <div className="mb-2 p-2 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-white/80 truncate">
                      <Paperclip className="size-3.5 text-blue-400" />
                      <span className="truncate">{attachment.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="text-white/40 hover:text-white"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}

                {isClosed ? (
                  <p className="text-center text-xs text-white/30 py-2">
                    This conversation is {displayConv.status.toLowerCase()}.
                  </p>
                ) : isChannelDisabled ? (
                  /* Disabled composer for SMS and WEB_CHAT */
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center text-xs text-amber-300">
                    Channel not enabled: Outbound agent replies for {displayConv.channel} are currently disabled.
                  </div>
                ) : (
                  <div className="relative flex items-center gap-2">
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={handleFileSelected}
                      className="hidden"
                    />

                    {/* Paperclip Button */}
                    <button
                      type="button"
                      disabled={uploadingAttachment}
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Add attachment"
                      className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0 cursor-pointer"
                    >
                      {uploadingAttachment ? (
                        <Loader2 className="size-4 animate-spin text-blue-400" />
                      ) : (
                        <Paperclip className="size-4" />
                      )}
                    </button>

                    <input
                      ref={replyInputRef}
                      type="text"
                      value={replyText}
                      disabled={sending}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && (replyText.trim() || attachment)) {
                          e.preventDefault();
                          void sendReply(false);
                        }
                      }}
                      placeholder={
                        displayConv.channel === "EMAIL"
                          ? "Type response as email reply (Enter to send)..."
                          : "Type response as agent (Enter to send)..."
                      }
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 pr-10 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-red-500/40 focus:ring-1 focus:ring-red-500/30 transition-all font-sans disabled:opacity-50"
                    />

                    <button
                      type="button"
                      disabled={(!replyText.trim() && !attachment) || sending}
                      onClick={() => void sendReply(false)}
                      aria-label="Send reply"
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
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Column 3: Customer History Side Panel ── */}
        {displayConv && (
          <div className="hidden xl:flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/90 backdrop-blur-2xl p-4 overflow-y-auto space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
                <Users className="size-3.5 text-blue-400" />
                Customer Account History
              </h3>
              <Link
                href={`/customers/${displayConv.customer.id}`}
                className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
              >
                <span>Full Profile</span>
                <ExternalLink className="size-3" />
              </Link>
            </div>

            {/* Quick Summary */}
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2 text-xs">
              <span className="font-bold text-white text-sm block">{displayConv.customer.name}</span>
              {displayConv.customer.company && (
                <div className="flex items-center gap-1.5 text-white/60">
                  <Building2 className="size-3 text-white/40" />
                  <span>{displayConv.customer.company}</span>
                </div>
              )}
              {displayConv.customer.taxId && (
                <div className="text-[11px] font-mono text-white/40">
                  GSTIN: {displayConv.customer.taxId}
                </div>
              )}
              <div className="pt-2 border-t border-white/5 flex justify-between text-[11px]">
                <span className="text-white/40">Terms:</span>
                <span className="font-mono text-blue-400">
                  {displayConv.customer.paymentTermsDays ? `Net ${displayConv.customer.paymentTermsDays}` : "Immediate"}
                </span>
              </div>
            </div>

            {/* Lifetime Metrics */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-[10px] text-white/40 uppercase block">Total Orders</span>
                <span className="text-base font-bold font-mono text-white">
                  {displayConv.orders?.length ?? 0}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-[10px] text-white/40 uppercase block">Recent Order</span>
                <span className="text-xs font-bold font-mono text-emerald-400">
                  {displayConv.orders?.[0] ? `₹${((displayConv.orders[0].totalMinor || 0) / 100).toFixed(0)}` : "—"}
                </span>
              </div>
            </div>

            {/* Recent Orders List */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">
                Order Activity
              </span>
              {(!displayConv.orders || displayConv.orders.length === 0) ? (
                <p className="text-xs text-white/30 font-mono py-2">No previous orders on record.</p>
              ) : (
                <div className="space-y-2">
                  {displayConv.orders.map((o) => (
                    <Link
                      key={o.id}
                      href={`/orders/${o.id}`}
                      className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 block text-xs space-y-1 transition-all"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <span className="font-bold text-white hover:text-red-400">
                          {o.orderNumber || o.draftNumber}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-white/70">
                          {o.status}
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] text-white/50">
                        <span>Total:</span>
                        <span className="font-mono text-white">₹{((o.totalMinor || 0) / 100).toFixed(2)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
