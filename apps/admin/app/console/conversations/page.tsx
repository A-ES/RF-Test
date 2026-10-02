"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  FileIcon,
  Filter,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { formatRelativeTime, formatClockTime } from "@/lib/utils";

interface Attachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  fileUrl?: string;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  senderRole: string;
  isRFTeam: boolean;
  content: string;
  messageType: string;
  attachments: Attachment[];
  createdAt: string;
}

interface ConversationItem {
  id: string;
  organizationId: string;
  organizationName: string;
  topic: string;
  contextLabel: string;
  rfLead: string;
  status: "OPEN" | "RESOLVED" | "CLOSED";
  type: "TEAM" | "DIRECT";
  unread: boolean;
  resolvedAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageIsRFTeam: boolean;
  messageCount: number;
}

interface OrgOption {
  id: string;
  name: string;
}

export default function AdminConversationsPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activeMessages, setActiveMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedOrgFilter, setSelectedOrgFilter] = useState("");

  // Input & attachments
  const [replyText, setReplyText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<{ fileName: string; fileSize: number; mimeType: string; storageKey: string }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // New conversation modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [modalOrgId, setModalOrgId] = useState("");
  const [modalTopic, setModalTopic] = useState("");
  const [modalContext, setModalContext] = useState("");
  const [modalInitialMessage, setModalInitialMessage] = useState("");
  const [isCreatingConv, setIsCreatingConv] = useState(false);

  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (unreadOnly) params.set("unread", "true");
      if (selectedOrgFilter) params.set("organizationId", selectedOrgFilter);

      const res = await fetch(`/api/admin/conversations?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load conversations");
      const data = await res.json();
      setConversations(data.conversations || []);
      if (!selectedId && data.conversations?.length > 0) {
        setSelectedId(data.conversations[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading conversations");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, unreadOnly, selectedOrgFilter, selectedId]);

  const fetchMessages = useCallback(async (convId: string) => {
    setIsLoadingMessages(true);
    try {
      const res = await fetch(`/api/admin/conversations/${convId}`);
      if (!res.ok) throw new Error("Failed to load messages");
      const data = await res.json();
      setActiveMessages(data.conversation?.messages || []);

      // If unread, mark read in admin
      fetch(`/api/admin/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unread: false }),
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load thread messages");
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // Fetch organizations for filter and creation dropdowns
  useEffect(() => {
    fetch("/api/admin/organizations?limit=200")
      .then((res) => res.json())
      .then((data) => {
        if (data.organizations) {
          setOrganizations(
            data.organizations.map((o: { id: string; name: string }) => ({
              id: o.id,
              name: o.name,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (selectedId) {
      void fetchMessages(selectedId);
    }
  }, [selectedId, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages]);

  // Polling fallback
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchConversations();
      if (selectedId) void fetchMessages(selectedId);
    }, 6000);
    return () => clearInterval(interval);
  }, [fetchConversations, fetchMessages, selectedId]);

  const activeConv = conversations.find((c) => c.id === selectedId);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeConv) return;

    const file = files[0];
    if (file.size > 25 * 1024 * 1024) {
      setError("File exceeds 25MB limit.");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const presignRes = await fetch("/api/admin/conversations/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: activeConv.organizationId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
        }),
      });

      if (!presignRes.ok) {
        const errData = await presignRes.json();
        throw new Error(errData.error || "Failed to generate upload URL");
      }

      const { uploadUrl, storageKey } = await presignRes.json();

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("Failed to upload file to cloud storage.");

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

  const handleDownloadAttachment = async (convId: string, attachmentId: string) => {
    try {
      const res = await fetch(`/api/admin/conversations/${convId}/attachments/${attachmentId}`);
      if (!res.ok) throw new Error("Could not retrieve download link");
      const data = await res.json();
      if (data.downloadUrl) {
        window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open attachment.");
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!replyText.trim() && pendingAttachments.length === 0) || !selectedId || isSending) return;

    setIsSending(true);
    const content = replyText.trim();
    const attachmentsToSend = [...pendingAttachments];
    setReplyText("");
    setPendingAttachments([]);
    setError(null);

    try {
      const res = await fetch(`/api/admin/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          attachments: attachmentsToSend,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to send reply");
      }

      const { message } = await res.json();
      setActiveMessages((prev) => [...prev, message]);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                lastMessageAt: message.createdAt,
                lastMessagePreview: message.content,
                lastMessageIsRFTeam: true,
                status: "OPEN",
              }
            : c,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleStatus = async (targetStatus: "RESOLVED" | "OPEN") => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/admin/conversations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      const { conversation } = await res.json();
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, status: conversation.status, resolvedAt: conversation.resolvedAt } : c,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status");
    }
  };

  const handleCreateNewConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalOrgId || !modalTopic.trim() || !modalContext.trim()) return;

    setIsCreatingConv(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: modalOrgId,
          topic: modalTopic.trim(),
          contextLabel: modalContext.trim(),
          initialMessage: modalInitialMessage.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create conversation");
      }

      const { conversation } = await res.json();
      setShowNewModal(false);
      setModalOrgId("");
      setModalTopic("");
      setModalContext("");
      setModalInitialMessage("");
      await fetchConversations();
      setSelectedId(conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setIsCreatingConv(false);
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.topic.toLowerCase().includes(q) ||
      c.organizationName.toLowerCase().includes(q) ||
      c.contextLabel.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--console-frame)]">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            CONSOLE / SUPPORT & MESSAGING
          </p>
          <h1 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            Client Organization Conversations
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--accent)" }}
        >
          <Plus className="size-3.5" />
          Start Conversation
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-3 flex items-center justify-between rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Main Split Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[380px_1fr] p-6 gap-6">
        {/* Left Sidebar: Threads List & Filters */}
        <div
          className="flex flex-col rounded-lg border overflow-hidden"
          style={{ background: "var(--console-panel)", borderColor: "var(--border)" }}
        >
          {/* Filter Bar */}
          <div className="p-3 border-b space-y-2.5" style={{ borderColor: "var(--border)" }}>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search org, topic, context..."
                className="w-full rounded border bg-black/20 pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                style={{ borderColor: "var(--border)" }}
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedOrgFilter}
                onChange={(e) => setSelectedOrgFilter(e.target.value)}
                className="flex-1 rounded border bg-black/20 px-2 py-1 text-[11px] text-[var(--text-primary)] focus:outline-none"
                style={{ borderColor: "var(--border)" }}
              >
                <option value="">All Organizations</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setUnreadOnly(!unreadOnly)}
                className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                  unreadOnly
                    ? "bg-[var(--accent)] text-white border-transparent"
                    : "text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Unread
              </button>
            </div>

            {/* Status pills */}
            <div className="flex gap-1">
              {(["ALL", "OPEN", "RESOLVED"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusFilter(tab)}
                  className={`flex-1 py-1 rounded text-[10px] font-mono uppercase tracking-wider text-center border transition-colors ${
                    statusFilter === tab
                      ? "bg-white/10 text-[var(--text-primary)] border-white/20 font-semibold"
                      : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {tab === "ALL" ? "All" : tab === "OPEN" ? "Open" : "Resolved"}
                </button>
              ))}
            </div>
          </div>

          {/* Threads List */}
          <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: "var(--border)" }}>
            {isLoading && (
              <div className="flex items-center justify-center p-8 text-xs text-[var(--text-muted)]">
                <Loader2 className="size-4 animate-spin mr-2" />
                Loading conversations…
              </div>
            )}
            {!isLoading && filteredConversations.length === 0 && (
              <div className="p-6 text-center text-xs text-[var(--text-muted)]">
                No client conversations match current filter.
              </div>
            )}
            {filteredConversations.map((conv) => {
              const isSelected = conv.id === selectedId;
              return (
                <div
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`p-3.5 cursor-pointer transition-colors relative ${
                    isSelected
                      ? "bg-white/[0.08] border-l-2"
                      : "hover:bg-white/[0.04]"
                  }`}
                  style={{ borderLeftColor: isSelected ? "var(--accent)" : "transparent" }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0 flex items-center gap-1.5">
                      {conv.unread && (
                        <span className="size-2 rounded-full shrink-0" style={{ background: "var(--accent)" }} />
                      )}
                      <span className="text-[11px] font-medium text-[var(--accent)] truncate">
                        {conv.organizationName}
                      </span>
                    </div>
                    {conv.status === "RESOLVED" && (
                      <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Resolved
                      </span>
                    )}
                  </div>

                  <h3 className="text-xs font-semibold text-[var(--text-primary)] truncate mb-1">
                    {conv.topic}
                  </h3>

                  <p className="text-[11px] text-[var(--text-muted)] truncate mb-2">
                    {conv.contextLabel}
                  </p>

                  <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                    <span className="truncate">{conv.rfLead}</span>
                    <span className="shrink-0">
                      {conv.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Active Conversation Feed */}
        <div
          className="flex flex-col rounded-lg border overflow-hidden"
          style={{ background: "var(--console-panel)", borderColor: "var(--border)" }}
        >
          {activeConv ? (
            <>
              {/* Header */}
              <div
                className="flex items-center justify-between border-b px-5 py-3.5"
                style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.02)" }}
              >
                <div className="min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/20">
                      {activeConv.organizationName}
                    </span>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {activeConv.topic}
                    </h2>
                    <span
                      className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                        activeConv.status === "RESOLVED"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/20"
                      }`}
                    >
                      {activeConv.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">
                    Context: <span className="text-[var(--text-secondary)]">{activeConv.contextLabel}</span> | Lead:{" "}
                    <span className="text-[var(--text-secondary)]">{activeConv.rfLead}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {activeConv.status === "RESOLVED" ? (
                    <button
                      type="button"
                      onClick={() => handleToggleStatus("OPEN")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs text-[var(--text-secondary)] hover:text-white transition-colors"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <RefreshCw className="size-3" />
                      Reopen
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleToggleStatus("RESOLVED")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <CheckCircle className="size-3" />
                      Resolve Thread
                    </button>
                  )}
                </div>
              </div>

              {/* Message Feed */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {isLoadingMessages && (
                  <div className="flex items-center justify-center p-8 text-xs text-[var(--text-muted)]">
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Loading messages…
                  </div>
                )}
                {!isLoadingMessages && activeMessages.length === 0 && (
                  <p className="text-xs text-[var(--text-muted)]">
                    No messages in this conversation yet. Send the first message below.
                  </p>
                )}
                {activeMessages.map((msg) => (
                  <div key={msg.id} className="flex gap-3 max-w-2xl">
                    <div
                      className={`size-8 rounded flex shrink-0 items-center justify-center text-xs font-semibold font-mono ${
                        msg.isRFTeam
                          ? "bg-[var(--accent)] text-white"
                          : "bg-white/10 border border-white/10 text-[var(--text-primary)]"
                      }`}
                    >
                      {msg.senderInitials}
                    </div>

                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                        <span className="font-semibold text-[var(--text-primary)]">
                          {msg.senderName}
                        </span>
                        <span className="px-1 rounded border text-[9px]" style={{ borderColor: "var(--border)" }}>
                          {msg.isRFTeam ? "RF Operations" : msg.senderRole}
                        </span>
                        <span>{formatClockTime(msg.createdAt)}</span>
                      </div>

                      <div
                        className={`rounded-lg p-3 text-xs leading-relaxed ${
                          msg.isRFTeam
                            ? "bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-[var(--text-primary)]"
                            : "bg-black/30 border border-white/10 text-[var(--text-primary)]"
                        }`}
                      >
                        {msg.content}

                        {/* Attachments rendering */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2.5 space-y-1.5 border-t border-white/10 pt-2">
                            {msg.attachments.map((att) => (
                              <button
                                key={att.id}
                                type="button"
                                onClick={() => handleDownloadAttachment(activeConv.id, att.id)}
                                className="flex items-center gap-2 rounded bg-black/40 border border-white/10 px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-white hover:border-[var(--accent)] transition-colors text-left"
                              >
                                <FileIcon className="size-3.5 shrink-0 text-[var(--accent)]" />
                                <span className="font-medium truncate max-w-[220px]">{att.fileName}</span>
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
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div
                className="p-3 border-t space-y-2"
                style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.02)" }}
              >
                {/* Pending attachments */}
                {pendingAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map((att, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 rounded bg-black/40 border border-white/10 px-2 py-1 text-[11px] text-[var(--text-primary)] font-mono"
                      >
                        <FileIcon className="size-3 text-[var(--accent)]" />
                        <span className="truncate max-w-[160px]">{att.fileName}</span>
                        <button
                          type="button"
                          onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-rose-400 hover:text-rose-300 ml-1"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleSendReply} className="flex items-center gap-2">
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
                    title="Attach file"
                    className="p-2.5 rounded border bg-black/20 text-[var(--text-secondary)] hover:text-white transition-colors disabled:opacity-40"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {isUploading ? (
                      <Loader2 className="size-4 animate-spin text-[var(--accent)]" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                  </button>

                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Reply as RF Intelligence staff..."
                    className="flex-1 rounded border bg-black/20 px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                    style={{ borderColor: "var(--border)" }}
                  />

                  <button
                    type="submit"
                    disabled={isSending || (!replyText.trim() && pendingAttachments.length === 0)}
                    className="flex items-center gap-1.5 rounded px-3 py-2 text-xs font-medium text-white transition-opacity disabled:opacity-30"
                    style={{ background: "var(--accent)" }}
                  >
                    {isSending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    <span>Reply</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-[var(--text-muted)]">
              {isLoading ? "Loading…" : "Select a client conversation from the list."}
            </div>
          )}
        </div>
      </div>

      {/* Start New Conversation Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div
            className="w-full max-w-md rounded-lg border p-5 shadow-xl"
            style={{ background: "var(--console-panel)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Start Conversation with Client
              </h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-[var(--text-muted)] hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewConversation} className="space-y-3 pt-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-[var(--text-muted)] mb-1">
                  Target Organization
                </label>
                <select
                  value={modalOrgId}
                  onChange={(e) => setModalOrgId(e.target.value)}
                  required
                  className="w-full rounded border bg-black/20 px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none"
                  style={{ borderColor: "var(--border)" }}
                >
                  <option value="">Select organization...</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-[var(--text-muted)] mb-1">
                  Topic / Subject
                </label>
                <input
                  type="text"
                  value={modalTopic}
                  onChange={(e) => setModalTopic(e.target.value)}
                  placeholder="e.g. Q4 Strategy Review"
                  required
                  className="w-full rounded border bg-black/20 px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none"
                  style={{ borderColor: "var(--border)" }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-[var(--text-muted)] mb-1">
                  Context Label
                </label>
                <input
                  type="text"
                  value={modalContext}
                  onChange={(e) => setModalContext(e.target.value)}
                  placeholder="e.g. Project Apollo / Quarterly Insights"
                  required
                  className="w-full rounded border bg-black/20 px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none"
                  style={{ borderColor: "var(--border)" }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-[var(--text-muted)] mb-1">
                  Initial Message (Optional)
                </label>
                <textarea
                  value={modalInitialMessage}
                  onChange={(e) => setModalInitialMessage(e.target.value)}
                  placeholder="Type an opening note for the client team..."
                  rows={3}
                  className="w-full rounded border bg-black/20 px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none"
                  style={{ borderColor: "var(--border)" }}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="rounded px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingConv || !modalOrgId || !modalTopic.trim() || !modalContext.trim()}
                  className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                  style={{ background: "var(--accent)" }}
                >
                  {isCreatingConv && <Loader2 className="size-3.5 animate-spin" />}
                  Create Thread
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
