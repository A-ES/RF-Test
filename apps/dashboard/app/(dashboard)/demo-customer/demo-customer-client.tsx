"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Smartphone,
  Send,
  Mic,
  RotateCcw,
  Sparkles,
  Bot,
  User,
  UserCheck,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  ChevronRight,
  AlertCircle,
  Package,
  FileText,
  DollarSign,
  Truck,
  Plus,
  RefreshCw,
  Loader2,
  Paperclip,
  Volume2,
} from "lucide-react";
import { useSession } from "@/app/providers/session-provider";
import { useOrgRealtime, type RealtimeEvent } from "@/app/lib/realtime/use-org-realtime";
import { cn } from "@/app/lib/utils";
import { Button } from "@/app/components/ui/button";
import { Avatar, AvatarFallback } from "@/app/components/ui/avatar";

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  company?: string | null;
}

interface MessageRow {
  id: string;
  sender: "CUSTOMER" | "AI" | "EMPLOYEE";
  body: string;
  providerMessageId?: string | null;
  attachmentsJson?: string | null;
  transcript?: string | null;
  createdAt: string;
}

interface OrderSummary {
  id: string;
  draftNumber: string;
  orderNumber: string | null;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
}

const SCRIPTED_PROMPTS = [
  {
    id: "spec-order",
    label: "Spec Order",
    badge: "Order Draft",
    text: "Hi, I need 20 cases of Product A and 10 units of Product B delivered tomorrow",
    color: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20",
  },
  {
    id: "misspelt-order",
    label: "Misspelt Order",
    badge: "Fuzzy Match",
    text: "Hi need 20 cses of Poduct A and 10 unts of Prduct B delivered tomorrow",
    color: "border-teal-500/30 text-teal-300 bg-teal-500/10 hover:bg-teal-500/20",
  },
  {
    id: "short-stock",
    label: "Short-Stock Order",
    badge: "Warning Flag",
    text: "I need 250 cases of Product A delivered tomorrow",
    color: "border-amber-500/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20",
  },
  {
    id: "order-change",
    label: "Order Change",
    badge: "Modify Draft",
    text: "Please make Product A 15 cases instead",
    color: "border-sky-500/30 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20",
  },
  {
    id: "refund-request",
    label: "Refund Request",
    badge: "Escalation",
    text: "I received damaged cases and I want a full refund immediately",
    color: "border-rose-500/30 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20",
  },
  {
    id: "general-question",
    label: "General Question",
    badge: "AI Q&A",
    text: "What are your delivery terms and catalog prices?",
    color: "border-indigo-500/30 text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20",
  },
];

export function DemoCustomerClient() {
  const { session } = useSession();
  const orgId = session?.organization?.id;
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [activeCustomer, setActiveCustomer] = useState<CustomerOption | null>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationStatus, setConversationStatus] = useState<string | null>(null);
  const [escalationReason, setEscalationReason] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);

  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // New demo customer modal state
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");

  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom of thread
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load org customers
  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/customers");
      if (!res.ok) return;
      const data = (await res.json()) as { customers?: CustomerOption[] } | CustomerOption[];
      const list = Array.isArray(data) ? data : data.customers || [];
      setCustomers(list);

      if (list.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(list[0].id);
        setActiveCustomer(list[0]);
      }
    } catch (err) {
      console.error("Failed to load customers:", err);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Fetch thread messages for active customer / conversation
  const loadThread = useCallback(async (custId?: string) => {
    const targetCustId = custId || selectedCustomerId;
    if (!targetCustId) return;

    try {
      const res = await fetch(`/api/demo/thread?customerId=${encodeURIComponent(targetCustId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        conversation: { id: string; status?: string; escalationReason?: string | null } | null;
        messages: MessageRow[];
        orders: OrderSummary[];
        customer: CustomerOption | null;
      };

      if (data.conversation) {
        setConversationId(data.conversation.id);
        setConversationStatus(data.conversation.status || null);
        setEscalationReason(data.conversation.escalationReason || null);
      } else {
        setConversationStatus(null);
        setEscalationReason(null);
      }
      setMessages(data.messages || []);
      setOrders(data.orders || []);
      if (data.customer) {
        setActiveCustomer(data.customer);
      }
    } catch (err) {
      console.error("Failed to load demo thread:", err);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    if (selectedCustomerId) {
      loadThread(selectedCustomerId);
    }
  }, [selectedCustomerId, loadThread]);

  // Realtime subscription via Ably
  const handleRealtimeMessage = useCallback(
    (event: RealtimeEvent) => {
      if (event.name === "messageCreated" || event.name === "message.created") {
        const payload = event.data as {
          conversationId?: string;
          message?: MessageRow;
          messageId?: string;
        };

        if (payload.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.message?.id)) return prev;
            return [...prev, payload.message!];
          });
        } else {
          // Re-fetch thread to catch latest AI or system update
          loadThread();
        }
      }
    },
    [loadThread],
  );

  const handleRealtimeOrder = useCallback(
    (event: RealtimeEvent) => {
      // When order is created or updated, refresh thread
      loadThread();
    },
    [loadThread],
  );

  const { live: messagesLive } = useOrgRealtime(
    orgId,
    "messages",
    handleRealtimeMessage,
  );
  useOrgRealtime(orgId, "orders", handleRealtimeOrder);

  // Polling fallback every 3 seconds to ensure sync even without Ably
  useEffect(() => {
    const timer = setInterval(() => {
      if (selectedCustomerId) {
        loadThread(selectedCustomerId);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [selectedCustomerId, loadThread]);

  // Send message
  async function handleSendMessage(textToSend?: string) {
    const text = (textToSend ?? inputText).trim();
    if (!text || sending) return;

    setSending(true);
    setInputText("");
    const clientMsgId = `demo_client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Optimistically append customer message
    const optimisticMessage: MessageRow = {
      id: clientMsgId,
      sender: "CUSTOMER",
      body: text,
      providerMessageId: clientMsgId,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch("/api/demo/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          text,
          messageId: clientMsgId,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        setFeedbackBanner(`Error sending message: ${errData.error || res.statusText}`);
      } else {
        const data = (await res.json()) as { conversationId?: string };
        if (data.conversationId) {
          setConversationId(data.conversationId);
        }
        // Immediately fetch thread to pick up draft creation ack
        setTimeout(() => loadThread(), 600);
      }
    } catch (err: unknown) {
      setFeedbackBanner(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  }

  // Handle audio attachment / transcription path
  async function handleAudioUpload(file: File) {
    setSending(true);
    setFeedbackBanner("Transcribing audio through Whisper voice engine...");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/demo/upload-audio", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Failed to upload/transcribe audio");
      }

      const data = (await res.json()) as {
        audioFileId: string;
        transcript: string;
      };

      setFeedbackBanner(`Audio transcribed: "${data.transcript}"`);

      // Send inbound with audioFileId and transcript
      const clientMsgId = `demo_voice_${Date.now()}`;
      await fetch("/api/demo/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          audioFileId: data.audioFileId,
          text: data.transcript,
          messageId: clientMsgId,
        }),
      });

      setTimeout(() => loadThread(), 600);
    } catch (err: unknown) {
      setFeedbackBanner(`Audio transcription error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSending(false);
    }
  }

  // Simulate audio note button
  async function handleSimulateAudio() {
    // Generate a minimal fake audio blob to exercise the exact transcription path
    const fakeAudioBlob = new Blob([new Uint8Array([0, 1, 2, 3])], { type: "audio/ogg" });
    const fakeFile = new File([fakeAudioBlob], "customer-order-voicenote.ogg", {
      type: "audio/ogg",
    });
    await handleAudioUpload(fakeFile);
  }

  // Reset Demo Data
  async function handleResetDemoData() {
    if (!confirm("Reset all DEMO-channel conversations, demo orders, and demo customers for this org?")) {
      return;
    }

    setResetting(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = (await res.json()) as {
        success: boolean;
        deleted?: { orders: number; conversations: number; messages: number; customers: number };
      };

      if (res.ok) {
        setMessages([]);
        setOrders([]);
        setConversationId(null);
        setConversationStatus(null);
        setEscalationReason(null);
        setFeedbackBanner(
          `Demo data reset: cleaned up ${data.deleted?.orders || 0} orders, ${data.deleted?.conversations || 0} conversations.`,
        );
        loadCustomers();
      } else {
        setFeedbackBanner("Failed to reset demo data.");
      }
    } catch {
      setFeedbackBanner("Network error resetting demo data.");
    } finally {
      setResetting(false);
    }
  }

  // Create new demo customer
  async function handleCreateNewCustomer() {
    if (!newCustName.trim() || !newCustPhone.trim()) return;

    try {
      const res = await fetch("/api/demo/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: newCustName.trim(),
            phone: newCustPhone.trim(),
          },
          text: "Hello, I am a new customer testing the demo channel.",
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { customerId: string };
        setShowNewCustomerModal(false);
        setNewCustName("");
        setNewCustPhone("");
        await loadCustomers();
        if (data.customerId) {
          setSelectedCustomerId(data.customerId);
          loadThread(data.customerId);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-6 max-w-7xl mx-auto w-full pb-12">
      {/* ── Top Header & Actions ────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-md shadow-2xl">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-mono font-bold tracking-wide">
              <Sparkles className="size-3" />
              DEMO CHANNEL
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono",
                messagesLive
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border border-amber-500/30",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  messagesLive ? "bg-emerald-400 animate-pulse" : "bg-amber-400",
                )}
              />
              {messagesLive ? "Live Realtime" : "Polling Mode"}
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Virtual Customer Terminal
          </h1>
          <p className="text-xs md:text-sm text-white/50 max-w-2xl">
            Simulate live WhatsApp customer orders, voice notes, and revisions with <strong>no external Meta APIs, credentials or tunnels</strong>. Every customer-facing message, draft acknowledgment, and order update reflects here in real time.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetDemoData}
            disabled={resetting}
            className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 text-xs gap-1.5 cursor-pointer"
          >
            {resetting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            Reset Demo Data
          </Button>

          <Link href="/conversations?channel=DEMO">
            <Button
              size="sm"
              className="bg-white/10 hover:bg-white/15 text-white border border-white/10 text-xs gap-1.5 cursor-pointer"
            >
              <ExternalLink className="size-3.5" />
              Open In Staff Inbox
            </Button>
          </Link>
        </div>
      </div>

      {feedbackBanner && (
        <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-200 text-xs flex items-center justify-between">
          <span>{feedbackBanner}</span>
          <button
            onClick={() => setFeedbackBanner(null)}
            className="text-purple-400 hover:text-white cursor-pointer ml-3 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Scripted Prompts Bar ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-purple-400" />
            One-Click Scripted Test Orders & Queries
          </span>
          <span className="text-[11px] text-white/40">
            Click any button to trigger the real ingest, NLP extraction & matching pipeline
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {SCRIPTED_PROMPTS.map((prompt) => (
            <button
              key={prompt.id}
              onClick={() => handleSendMessage(prompt.text)}
              disabled={sending}
              className={cn(
                "flex flex-col items-start text-left p-2.5 rounded-xl border transition-all cursor-pointer shadow-xs",
                prompt.color,
                sending && "opacity-50 cursor-not-allowed",
              )}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="text-xs font-bold">{prompt.label}</span>
                <span className="text-[9px] uppercase px-1 py-0.2 rounded font-mono bg-white/10">
                  {prompt.badge}
                </span>
              </div>
              <p className="text-[10px] text-white/60 line-clamp-2 leading-relaxed">
                "{prompt.text}"
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Phone Simulator & Side Panel Grid ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left/Center Column: Realistic Smartphone Container */}
        <div className="lg:col-span-7 flex justify-center">
          <div className="w-full max-w-[440px] rounded-[44px] p-3.5 bg-gradient-to-b from-zinc-800 via-zinc-900 to-black border-[4px] border-zinc-700/80 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_50px_rgba(168,85,247,0.15)] flex flex-col min-h-[680px] max-h-[800px]">
            {/* Phone Bezel Screen */}
            <div className="w-full h-full flex-1 rounded-[36px] bg-[#0c0f14] overflow-hidden border border-white/[0.08] flex flex-col relative shadow-inner">
              {/* Dynamic Island / Status Bar */}
              <div className="h-10 w-full bg-[#0c0f14] px-6 flex items-center justify-between text-[11px] font-medium text-white/80 select-none shrink-0 z-20">
                <span className="font-mono">9:41</span>
                {/* Center Dynamic Pill */}
                <div className="w-24 h-4 bg-black rounded-full flex items-center justify-center gap-1.5 px-2">
                  <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] font-mono text-emerald-400">DEMO</span>
                </div>
                <div className="flex items-center gap-1.5 text-white/70">
                  <span className="text-[10px] font-mono">5G</span>
                  <div className="w-4 h-2 rounded-xs border border-white/70 flex items-center p-0.5">
                    <div className="h-full w-2.5 bg-white rounded-xs" />
                  </div>
                </div>
              </div>

              {/* Chat Contact Header */}
              <div className="px-4 py-3 bg-zinc-900/90 border-b border-white/[0.06] backdrop-blur-md flex items-center justify-between shrink-0 z-10">
                <div className="flex items-center gap-2.5">
                  <Avatar className="size-9 ring-1 ring-white/10 bg-gradient-to-tr from-purple-600 to-indigo-600">
                    <AvatarFallback className="text-white text-xs font-bold">RF</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-white">RF Intelligence</span>
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                    </div>
                    <span className="text-[10px] text-white/40 font-mono">
                      Official Vendor Service · WhatsApp Simulator
                    </span>
                  </div>
                </div>

                {/* Customer Pill & Status Switcher */}
                <div className="flex items-center gap-1.5">
                  {conversationStatus === "HUMAN_ESCALATION" ? (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
                      ESCALATED
                    </span>
                  ) : (
                    <div className="flex items-center gap-1 bg-white/[0.05] border border-white/10 px-2 py-1 rounded-full text-[10px] text-white/80">
                      <User className="size-3 text-purple-400" />
                      <span className="truncate max-w-[90px] font-medium">
                        {activeCustomer ? activeCustomer.name.split(" ")[0] : "Customer"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Chat Thread Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/40 via-[#0c0f14] to-[#0c0f14]">
                {/* Date separator */}
                <div className="flex justify-center my-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[10px] text-white/50 font-mono">
                    Today · End-to-End Demo Channel
                  </span>
                </div>

                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center px-4">
                    <div className="size-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3">
                      <Smartphone className="size-6" />
                    </div>
                    <p className="text-xs font-semibold text-white/80 mb-1">Customer Inbox is Ready</p>
                    <p className="text-[11px] text-white/40 max-w-[240px]">
                      Send the <strong>Spec Order</strong> from the top row to see how the system understands intent and drafts orders.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isCustomer = msg.sender === "CUSTOMER";
                    const isAutomated = msg.body.startsWith("[automated update]");
                    const cleanBody = isAutomated
                      ? msg.body.replace("[automated update]", "").trim()
                      : msg.body;

                    return (
                      <div
                        key={msg.id}
                        className={cn("flex flex-col", isCustomer ? "items-end" : "items-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-md leading-relaxed relative transition-all",
                            isCustomer
                              ? "bg-emerald-600 text-white rounded-br-xs font-medium"
                              : isAutomated
                                ? "bg-gradient-to-r from-purple-950/70 to-indigo-950/70 text-purple-100 border border-purple-500/30 rounded-bl-xs"
                                : "bg-zinc-800/90 text-white/90 border border-white/10 rounded-bl-xs",
                          )}
                        >
                          {!isCustomer && (
                            <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono text-purple-300">
                              {msg.sender === "AI" ? (
                                <>
                                  <Bot className="size-3" />
                                  <span>RF AI Assistant</span>
                                </>
                              ) : (
                                <>
                                  <UserCheck className="size-3 text-blue-300" />
                                  <span className="text-blue-300">RF Team Admin</span>
                                </>
                              )}
                              {isAutomated && (
                                <span className="bg-purple-400/20 px-1 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider text-purple-200">
                                  Lifecycle Update
                                </span>
                              )}
                            </div>
                          )}

                          <p className="whitespace-pre-wrap">{cleanBody}</p>

                          <div
                            className={cn(
                              "mt-1 flex items-center justify-end gap-1 text-[9px] font-mono",
                              isCustomer ? "text-emerald-200" : "text-white/40",
                            )}
                          >
                            <span>
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {isCustomer && <CheckCheck className="size-3 text-emerald-200" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {conversationStatus === "HUMAN_ESCALATION" && (
                  <div className="flex flex-col items-center gap-1.5 my-3 p-3.5 rounded-2xl bg-gradient-to-r from-amber-950/60 to-rose-950/60 border border-amber-500/30 text-amber-200 text-center shadow-lg">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
                      <AlertCircle className="size-4 text-amber-400" />
                      <span>Ticket Escalated to Human Support</span>
                    </div>
                    <p className="text-[11px] text-amber-200/80 leading-relaxed max-w-xs">
                      {escalationReason || "Customer refund or dispute requires human operator review. AI bots cannot issue refunds autonomously."}
                    </p>
                    <Link
                      href="/conversations?channel=DEMO"
                      className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-200 text-xs font-semibold transition"
                    >
                      Open Staff Inbox to Reply
                      <ExternalLink className="size-3" />
                    </Link>
                  </div>
                )}

                <div ref={threadEndRef} />
              </div>

              {/* Linked Draft Orders Banner in Phone Screen */}
              {orders.length > 0 && (
                <div className="p-2.5 bg-zinc-900/95 border-t border-white/[0.08] flex items-center justify-between text-xs shrink-0">
                  <div className="flex items-center gap-1.5 text-purple-300">
                    <Package className="size-3.5" />
                    <span className="font-semibold text-[11px]">
                      {orders[0].orderNumber || orders[0].draftNumber} ({orders[0].status})
                    </span>
                  </div>
                  <Link
                    href={`/orders/${orders[0].id}`}
                    target="_blank"
                    className="flex items-center gap-1 px-2 py-1 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-[10px] font-medium transition cursor-pointer"
                  >
                    Manage Order
                    <ChevronRight className="size-3" />
                  </Link>
                </div>
              )}

              {/* Chat Input Bar */}
              <div className="p-3 bg-zinc-900 border-t border-white/[0.08] shrink-0">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="flex items-center gap-2"
                >
                  {/* Attach Audio / File Button */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleAudioUpload(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSimulateAudio}
                    title="Simulate / Record Voice Note"
                    disabled={sending}
                    className="size-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white flex items-center justify-center transition cursor-pointer shrink-0"
                  >
                    <Mic className="size-4 text-purple-400" />
                  </button>

                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Message RF Intelligence..."
                    disabled={sending}
                    className="flex-1 bg-white/[0.06] border border-white/10 rounded-full px-3.5 py-2 text-xs text-white placeholder-white/40 focus:outline-hidden focus:ring-1 focus:ring-purple-500"
                  />

                  <button
                    type="submit"
                    disabled={!inputText.trim() || sending}
                    className={cn(
                      "size-8 rounded-full flex items-center justify-center transition shrink-0 cursor-pointer",
                      inputText.trim() && !sending
                        ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-md"
                        : "bg-white/[0.06] text-white/30 cursor-not-allowed",
                    )}
                  >
                    {sending ? (
                      <Loader2 className="size-4 animate-spin text-white" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Customer Switcher, Order Timeline & Workflow Helper */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Active Customer Selector Card */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-md">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                <User className="size-3.5 text-purple-400" />
                Active Demo Customer
              </span>
              <button
                onClick={() => setShowNewCustomerModal(true)}
                className="text-[11px] text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1 cursor-pointer"
              >
                <Plus className="size-3" />
                New Customer
              </button>
            </div>

            <div className="space-y-3">
              <select
                value={selectedCustomerId}
                onChange={(e) => {
                  setSelectedCustomerId(e.target.value);
                  const cust = customers.find((c) => c.id === e.target.value);
                  if (cust) setActiveCustomer(cust);
                }}
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-hidden focus:ring-1 focus:ring-purple-500"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id} className="bg-zinc-900 text-white">
                    {c.name} {c.company ? `(${c.company})` : ""} · {c.phone || c.whatsapp || "No phone"}
                  </option>
                ))}
              </select>

              {activeCustomer && (
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-white/40">Name</span>
                    <span className="font-medium text-white">{activeCustomer.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/40">Channel Address</span>
                    <span className="font-mono text-purple-300">
                      {activeCustomer.phone || activeCustomer.whatsapp || "demo-customer"}
                    </span>
                  </div>
                  {activeCustomer.company && (
                    <div className="flex items-center justify-between">
                      <span className="text-white/40">Company</span>
                      <span className="text-white/80">{activeCustomer.company}</span>
                    </div>
                  )}
                  {conversationStatus && (
                    <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
                      <span className="text-white/40">Conv. Status</span>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase",
                          conversationStatus === "HUMAN_ESCALATION"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : conversationStatus === "WAITING_FOR_CUSTOMER"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : "bg-purple-500/20 text-purple-300 border border-purple-500/30",
                        )}
                      >
                        {conversationStatus}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Orders Generated from this Conversation */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-md">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                <Package className="size-3.5 text-purple-400" />
                Orders In Progress ({orders.length})
              </span>
              <button
                onClick={() => loadThread()}
                className="text-[11px] text-white/40 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="size-3" />
                Refresh
              </button>
            </div>

            {orders.length === 0 ? (
              <p className="text-xs text-white/40 italic py-2">
                No draft orders yet. Click "Spec Order" above to generate a draft order from chat.
              </p>
            ) : (
              <div className="space-y-2.5">
                {orders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-purple-500/30 transition flex items-center justify-between"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white font-mono">
                          {ord.orderNumber || ord.draftNumber}
                        </span>
                        <span
                          className={cn(
                            "px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase",
                            ord.status === "APPROVED"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : ord.status === "DRAFT"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-purple-500/20 text-purple-300",
                          )}
                        >
                          {ord.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-white/50 font-mono">
                        {(ord.totalMinor / 100).toLocaleString("en-US", {
                          style: "currency",
                          currency: ord.currency || "USD",
                        })}
                      </span>
                    </div>

                    <Link
                      href={`/orders/${ord.id}`}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-medium transition cursor-pointer"
                    >
                      Open & Approve
                      <ExternalLink className="size-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* End-to-End Walkthrough Step Guide */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-950/30 via-zinc-900/40 to-black border border-purple-500/20 text-xs space-y-3">
            <h3 className="font-bold text-white flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-purple-400" />
              Full RF Workflow Walkthrough
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-white/70 leading-relaxed">
              <li>
                Click <strong className="text-emerald-300">Spec Order</strong>: The ingest pipeline extracts products & creates a Draft Order.
              </li>
              <li>
                Click <strong className="text-purple-300">Open & Approve</strong>: Review candidate SKUs, edit quantities, and approve.
              </li>
              <li>
                Upon approval, Inngest triggers the post-approval pipeline: sequential gapless invoice PDF, payment link generation, fulfillment, and automated customer updates.
              </li>
              <li>
                Watch every customer confirmation, invoice due notice, and delivery alert arrive live right here in the phone window!
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* New Customer Modal */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-white">Create Demo Customer</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-white/50 block mb-1">Customer Name</label>
                <input
                  type="text"
                  placeholder="e.g. Acme Supermarket"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[11px] text-white/50 block mb-1">Phone Number (E.164)</label>
                <input
                  type="text"
                  placeholder="e.g. +15559876543"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNewCustomerModal(false)}
                className="text-xs text-white/60"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateNewCustomer}
                className="bg-purple-600 hover:bg-purple-500 text-white text-xs"
              >
                Create & Switch
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
