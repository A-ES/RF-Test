"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  FileIcon,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import {
  formatClockTime,
  formatRelativeTime,
} from "@/app/lib/format";
import {
  useOrgRealtime,
  type RealtimeEvent,
} from "@/app/lib/realtime/use-org-realtime";

interface ApiAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey?: string;
  fileUrl?: string | null;
}

interface ApiParticipant {
  id: string;
  role: string;
  user: {
    id: string;
    name: string;
    avatarInitials: string;
    role: string;
  } | null;
}

interface ApiConversationSummary {
  id: string;
  topic: string;
  contextLabel: string;
  rfLead: string;
  status: "OPEN" | "RESOLVED" | "CLOSED";
  type: "TEAM" | "DIRECT";
  unread: boolean;
  resolvedAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
  participants?: ApiParticipant[];
}

interface ApiMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  senderRole: string;
  isRFTeam: boolean;
  content: string;
  messageType: string;
  attachments?: ApiAttachment[];
  createdAt: string;
}

export default function MessagesPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ApiConversationSummary[]>([]);
  const [messages, setMessages] = useState<Record<string, ApiMessage[]>>({});
  const [selectedId, setSelectedId] = useState("");
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [newContext, setNewContext] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Attachment state
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{ fileName: string; fileSize: number; mimeType: string; storageKey: string }>
  >([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const handleUnauthorized = useCallback(() => {
    router.replace("/login");
  }, [router]);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (!res.ok) {
      setError("Could not load conversations. Please refresh.");
      return;
    }
    const data = (await res.json()) as {
      conversations: ApiConversationSummary[];
    };
    setConversations(data.conversations);
    setSelectedId((prev) => prev || data.conversations[0]?.id || "");
  }, [handleUnauthorized]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      const res = await fetch(
        `/api/conversations/${conversationId}/messages`,
      );
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { messages: ApiMessage[] };
      setMessages((prev) => ({ ...prev, [conversationId]: data.messages }));
    },
    [handleUnauthorized],
  );

  // Resolve the organization for the realtime channel from the signed session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as {
          organization: { id: string } | null;
        };
        if (!cancelled) setOrgId(data.organization?.id ?? null);
      } catch {
        // Realtime optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handleUnauthorized]);

  useEffect(() => {
    void loadConversations().finally(() => setIsLoading(false));
  }, [loadConversations]);

  // Load (and mark read) the active thread whenever the selection changes.
  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
    void fetch(`/api/conversations/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unread: false }),
    })
      .then((res) => {
        if (res.ok) {
          setConversations((prev) =>
            prev.map((c) => (c.id === selectedId ? { ...c, unread: false } : c)),
          );
        }
      })
      .catch(() => {});
  }, [selectedId, loadMessages]);

  const handleRealtime = useCallback(
    (event: RealtimeEvent) => {
      if (event.name === "message:new") {
        const payload = event.data as {
          conversationId: string;
          message: ApiMessage;
        };
        setMessages((prev) => {
          const existing = prev[payload.conversationId] ?? [];
          if (existing.some((m) => m.id === payload.message.id)) return prev;
          return {
            ...prev,
            [payload.conversationId]: [...existing, payload.message],
          };
        });
        setConversations((prev) =>
          prev.map((c) =>
            c.id === payload.conversationId
              ? {
                  ...c,
                  lastMessageAt: payload.message.createdAt,
                  lastMessagePreview: payload.message.content,
                  unread: c.id === selectedId ? false : true,
                  status: c.status === "RESOLVED" ? "OPEN" : c.status,
                }
              : c,
          ),
        );
      } else if (event.name === "conversation:new") {
        void loadConversations();
      } else if (event.name === "conversation:updated") {
        const payload = event.data as {
          conversation: ApiConversationSummary;
        };
        setConversations((prev) =>
          prev.map((c) => (c.id === payload.conversation.id ? { ...c, ...payload.conversation } : c)),
        );
      }
    },
    [loadConversations, selectedId],
  );

  const { live } = useOrgRealtime(orgId, "messages", handleRealtime);

  // Fallback poll
  useEffect(() => {
    if (live || !selectedId) return;
    const interval = setInterval(() => {
      void loadConversations();
      void loadMessages(selectedId);
    }, 8000);
    return () => clearInterval(interval);
  }, [live, selectedId, loadConversations, loadMessages]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedId]);

  const activeConv =
    conversations.find((c) => c.id === selectedId) ?? conversations[0];
  const activeMessages = activeConv ? messages[activeConv.id] ?? [] : [];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (file.size > 25 * 1024 * 1024) {
      setError("File exceeds 25MB limit.");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // 1. Get presigned upload url
      const presignRes = await fetch("/api/conversations/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
        }),
      });

      if (!presignRes.ok) {
        const errData = await presignRes.json();
        throw new Error(errData.error || "Failed to prepare file upload");
      }

      const { uploadUrl, storageKey } = await presignRes.json();

      // 2. Upload file directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload file to cloud storage.");
      }

      setPendingAttachments((prev) => [
        ...prev,
        {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          storageKey,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadAttachment = async (conversationId: string, attachmentId: string, fileName: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/attachments/${attachmentId}`);
      if (!res.ok) throw new Error("Could not retrieve secure download link");
      const data = await res.json();
      if (data.downloadUrl) {
        window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open attachment.");
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if ((!content && pendingAttachments.length === 0) || !selectedId || isSending) return;

    setIsSending(true);
    setInput("");
    const attachmentsToSend = [...pendingAttachments];
    setPendingAttachments([]);
    setError(null);

    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          attachments: attachmentsToSend,
        }),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) {
        setError("Message could not be sent. Please try again.");
        return;
      }
      const data = (await res.json()) as { message: ApiMessage };
      setMessages((prev) => {
        const existing = prev[selectedId] ?? [];
        if (existing.some((m) => m.id === data.message.id)) return prev;
        return { ...prev, [selectedId]: [...existing, data.message] };
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                lastMessageAt: data.message.createdAt,
                lastMessagePreview: data.message.content,
                status: "OPEN",
              }
            : c,
        ),
      );
    } catch {
      setError("Message could not be sent. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleStatus = async (targetStatus: "RESOLVED" | "OPEN") => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });
      if (res.ok) {
        const data = (await res.json()) as { conversation: ApiConversationSummary };
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedId ? { ...c, status: data.conversation.status } : c)),
        );
      }
    } catch {
      setError("Failed to update status.");
    }
  };

  const handleCreateConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    const topic = newTopic.trim();
    const contextLabel = newContext.trim();
    if (!topic || !contextLabel) return;

    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, contextLabel, type: "TEAM" }),
      });
      if (res.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!res.ok) {
        setError("Could not start a new thread. Please try again.");
        return;
      }
      const data = (await res.json()) as {
        conversation: ApiConversationSummary;
      };
      setConversations((prev) => [data.conversation, ...prev]);
      setMessages((prev) => ({ ...prev, [data.conversation.id]: [] }));
      setSelectedId(data.conversation.id);
      setNewTopic("");
      setNewContext("");
      setShowNewForm(false);
    } catch {
      setError("Could not start a new thread. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const filteredConvs = conversations.filter((c) => {
    if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.topic.toLowerCase().includes(q) ||
      c.contextLabel.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-[1280px] space-y-4 h-[calc(100vh-6.5rem)] flex flex-col">
      {/* Top Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <p className="dash-eyebrow">/ internal team messages</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">
            Client Team ↔ RF Operations Messaging
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] bg-[var(--surface-elevated)] border border-[var(--border)] px-3 py-1.5 rounded-lg">
            <ShieldCheck className="size-3.5 text-[var(--accent)]" />
            <span>{live ? "Live" : "Secure Channel"}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-[var(--dash-status-error,#ef4444)]/40 bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--dash-status-error,#ef4444)] flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Main Two-Column View */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        {/* Left Column: Conversation List */}
        <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          {/* Search Header */}
          <div className="p-3 border-b border-[var(--border)] bg-[var(--surface-elevated)]/30 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter threads..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>

            {/* Status Tabs */}
            <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[10px] font-medium">
              {(["ALL", "OPEN", "RESOLVED"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusFilter(tab)}
                  className={`flex-1 py-1 rounded text-center transition-colors ${
                    statusFilter === tab
                      ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] font-semibold shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {tab === "ALL" ? "All" : tab === "OPEN" ? "Active" : "Resolved"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowNewForm((prev) => !prev)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Plus className="size-3" />
              New thread
            </button>

            {showNewForm && (
              <form
                onSubmit={handleCreateConversation}
                className="space-y-1.5 rounded-lg border border-[var(--border)] p-2"
              >
                <input
                  type="text"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="Topic / Subject"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <input
                  type="text"
                  value={newContext}
                  onChange={(e) => setNewContext(e.target.value)}
                  placeholder="Context (e.g. Project, Task, or Account)"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="submit"
                  disabled={isCreating || !newTopic.trim() || !newContext.trim()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] py-1 text-[11px] font-medium text-white disabled:opacity-40"
                >
                  {isCreating && <Loader2 className="size-3 animate-spin" />}
                  Create thread
                </button>
              </form>
            )}
          </div>

          {/* List Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {isLoading && (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-[var(--text-muted)]">
                <Loader2 className="size-3.5 animate-spin" />
                Loading threads…
              </div>
            )}
            {!isLoading && filteredConvs.length === 0 && (
              <p className="p-4 text-xs text-[var(--text-muted)]">
                No threads found. Start one with “New thread”.
              </p>
            )}
            {filteredConvs.map((conv) => {
              const isSelected = activeConv?.id === conv.id;

              return (
                <div
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`p-3.5 cursor-pointer transition-all duration-150 relative ${
                    isSelected
                      ? "bg-[var(--surface-elevated)] border-l-2 border-l-[var(--accent)]"
                      : "hover:bg-[var(--surface-elevated)]/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0 flex items-center gap-1.5">
                      {conv.unread && (
                        <span className="size-2 rounded-full bg-[var(--accent)] shrink-0" />
                      )}
                      <h3 className="truncate text-xs font-semibold text-[var(--text-primary)]">
                        {conv.topic}
                      </h3>
                    </div>
                    {conv.status === "RESOLVED" && (
                      <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-[var(--dash-status-success,#10b981)]/10 text-[var(--dash-status-success,#10b981)] border border-[var(--dash-status-success,#10b981)]/20">
                        Resolved
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-[var(--accent)] font-medium mb-1 truncate">
                    {conv.contextLabel}
                  </p>

                  <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                    <span className="truncate">{conv.rfLead}</span>
                    <span className="shrink-0">
                      {conv.lastMessageAt
                        ? formatRelativeTime(conv.lastMessageAt)
                        : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Thread Stream */}
        <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          {activeConv ? (
            <>
              {/* Thread Header */}
              <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-elevated)]/40 flex items-center justify-between shrink-0">
                <div className="min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {activeConv.topic}
                    </h2>
                    <span
                      className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                        activeConv.status === "RESOLVED"
                          ? "bg-[var(--dash-status-success,#10b981)]/10 text-[var(--dash-status-success,#10b981)] border-[var(--dash-status-success,#10b981)]/20"
                          : "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20"
                      }`}
                    >
                      {activeConv.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mt-1">
                    <span className="text-[var(--accent)] font-medium">
                      {activeConv.contextLabel}
                    </span>
                    <span className="text-[var(--border)]">|</span>
                    <span className="font-mono text-[11px]">
                      Lead: {activeConv.rfLead}
                    </span>
                    {activeConv.participants && activeConv.participants.length > 0 && (
                      <>
                        <span className="text-[var(--border)]">|</span>
                        <div className="flex items-center gap-1 font-mono text-[10px]">
                          <Users className="size-3" />
                          <span>{activeConv.participants.length}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {activeConv.status === "RESOLVED" ? (
                    <button
                      type="button"
                      onClick={() => handleToggleStatus("OPEN")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
                    >
                      <RefreshCw className="size-3" />
                      Reopen
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleToggleStatus("RESOLVED")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--dash-status-success,#10b981)]/30 bg-[var(--dash-status-success,#10b981)]/10 text-xs font-medium text-[var(--dash-status-success,#10b981)] hover:bg-[var(--dash-status-success,#10b981)]/20 transition-colors"
                    >
                      <CheckCircle className="size-3" />
                      Resolve
                    </button>
                  )}
                </div>
              </div>

              {/* Messages Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeMessages.length === 0 && (
                  <p className="text-xs text-[var(--text-muted)]">
                    No messages yet. Say hello to the RF Operations team.
                  </p>
                )}
                {activeMessages.map((msg) => (
                  <div key={msg.id} className="flex gap-3 max-w-2xl">
                    <div
                      className={`size-8 rounded-lg flex shrink-0 items-center justify-center text-xs font-semibold font-mono ${
                        msg.isRFTeam
                          ? "bg-[var(--accent)] text-white shadow-xs"
                          : "bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--text-primary)]"
                      }`}
                    >
                      {msg.senderInitials}
                    </div>

                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                        <span className="font-semibold text-[var(--text-primary)]">
                          {msg.senderName}
                        </span>
                        <span className="bg-[var(--surface-elevated)] px-1 rounded border border-[var(--border)]">
                          {msg.senderRole}
                        </span>
                        <span>{formatClockTime(msg.createdAt)}</span>
                      </div>

                      <div
                        className={`rounded-xl p-3.5 text-xs leading-relaxed ${
                          msg.isRFTeam
                            ? "bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--text-primary)]"
                            : "bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--text-primary)]"
                        }`}
                      >
                        {msg.content}

                        {/* Attachments rendering */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2.5 space-y-1.5 border-t border-black/10 dark:border-white/10 pt-2">
                            {msg.attachments.map((att) => (
                              <button
                                key={att.id}
                                type="button"
                                onClick={() => handleDownloadAttachment(activeConv.id, att.id, att.fileName)}
                                className="flex items-center gap-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors text-left"
                              >
                                <FileIcon className="size-3.5 shrink-0 text-[var(--accent)]" />
                                <span className="font-medium truncate max-w-[240px]">{att.fileName}</span>
                                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                                  ({(att.fileSize / 1024).toFixed(0)} KB)
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={feedEndRef} />
              </div>

              {/* Input Box Footer */}
              <div className="p-3 border-t border-[var(--border)] bg-[var(--surface-elevated)]/30 shrink-0 space-y-2">
                {/* Pending attachments chips */}
                {pendingAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map((att, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-primary)] font-mono"
                      >
                        <FileIcon className="size-3 text-[var(--accent)]" />
                        <span className="truncate max-w-[160px]">{att.fileName}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-[var(--text-muted)] hover:text-[var(--dash-status-error,#ef4444)] ml-1"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="relative flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    title="Attach file (PDF, Doc, Image, CSV up to 25MB)"
                    className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-40"
                  >
                    {isUploading ? (
                      <Loader2 className="size-4 animate-spin text-[var(--accent)]" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                  </button>

                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Post a message or attachment to RF Intelligence..."
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 pr-12 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={isSending || (!input.trim() && pendingAttachments.length === 0)}
                      className="absolute right-2 top-2 p-1.5 rounded-md bg-[var(--accent)] text-white transition-all hover:bg-[var(--accent-hover)] disabled:opacity-30"
                    >
                      {isSending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Send className="size-3.5" />
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-[var(--text-muted)]">
              {isLoading ? "Loading…" : "Select a thread to view messages."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

