"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Mail,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  ChevronLeft,
  RefreshCw,
  Plus,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/utils";

interface IntegrationData {
  whatsapp: {
    status: "CONNECTED" | "CONFIGURATION_INCOMPLETE" | "NOT_CONFIGURED";
    phoneNumberId: string | null;
    displayLabel: string | null;
    webhookUrl: string;
    hasAccessToken: boolean;
    hasAppSecret: boolean;
    hasVerifyToken: boolean;
    lastWebhookAt: string | null;
    lastMessageStatus: string | null;
  };
  email: {
    status: "CONNECTED" | "CONFIGURATION_INCOMPLETE" | "NOT_CONFIGURED";
    inboundMailbox: string | null;
    displayLabel: string | null;
    webhookUrl: string;
    provider: string;
    hasWebhookSecret: boolean;
    hasApiKey: boolean;
    lastWebhookAt: string | null;
    lastEmailSubject: string | null;
  };
}

export default function IntegrationsSettingsPage() {
  const [data, setData] = useState<IntegrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Form states for registering inboxes
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waLabel, setWaLabel] = useState("");
  const [savingWa, setSavingWa] = useState(false);

  const [emailBox, setEmailBox] = useState("");
  const [emailLabel, setEmailLabel] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function loadIntegrations() {
    try {
      setLoading(true);
      const res = await fetch("/api/messaging/integrations");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.whatsapp.phoneNumberId) setWaPhoneId(json.whatsapp.phoneNumberId);
        if (json.whatsapp.displayLabel) setWaLabel(json.whatsapp.displayLabel);
        if (json.email.inboundMailbox) setEmailBox(json.email.inboundMailbox);
        if (json.email.displayLabel) setEmailLabel(json.email.displayLabel);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadIntegrations();
  }, []);

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function handleSaveInbox(provider: "WHATSAPP" | "EMAIL") {
    setMessage(null);
    const isWa = provider === "WHATSAPP";
    if (isWa) setSavingWa(true);
    else setSavingEmail(true);

    try {
      const address = isWa ? waPhoneId.trim() : emailBox.trim();
      const label = isWa ? waLabel.trim() : emailLabel.trim();

      if (!address) {
        setMessage({ text: `Please provide a valid ${isWa ? "Phone Number ID" : "Email Address"}`, error: true });
        return;
      }

      const res = await fetch("/api/messaging/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          externalAddress: address,
          displayLabel: label || undefined,
        }),
      });

      const resData = await res.json();
      if (res.ok) {
        setMessage({ text: resData.message || "Saved successfully!" });
        await loadIntegrations();
      } else {
        setMessage({ text: resData.error || "Failed to save inbox", error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || "An error occurred", error: true });
    } finally {
      if (isWa) setSavingWa(false);
      else setSavingEmail(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
        <div className="space-y-1">
          <Link
            href="/conversations"
            className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
          >
            <ChevronLeft className="size-3.5" />
            <span>Back to Conversations</span>
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Communication Channels & Webhook Integrations
          </h1>
          <p className="text-xs text-white/50">
            Configure official Meta WhatsApp Cloud API and Inbound/Outbound Email endpoints for customer messaging.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadIntegrations()}
          disabled={loading}
          className="border-white/10 bg-white/[0.03] text-xs text-white/80 hover:bg-white/[0.08]"
        >
          <RefreshCw className={cn("size-3.5 mr-1.5", loading && "animate-spin")} />
          Refresh Status
        </Button>
      </div>

      {message && (
        <div
          className={cn(
            "p-3 rounded-xl text-xs flex items-center gap-2 border",
            message.error
              ? "bg-rose-500/10 border-rose-500/20 text-rose-300"
              : "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
          )}
        >
          {message.error ? <AlertCircle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-white/40">
          <Loader2 className="size-6 animate-spin mr-2" />
          <span className="text-sm">Verifying integration status…</span>
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ── WHATSAPP BUSINESS CARD ── */}
          <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/90 backdrop-blur-xl p-5 space-y-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <MessageSquare className="size-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">WhatsApp Business</h2>
                  <p className="text-[11px] text-white/50">Official Meta Cloud API (v21.0)</p>
                </div>
              </div>

              <div
                className={cn(
                  "px-2.5 py-1 rounded-full text-[10px] font-mono font-medium flex items-center gap-1.5 border",
                  data.whatsapp.status === "CONNECTED"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : data.whatsapp.status === "CONFIGURATION_INCOMPLETE"
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      : "bg-white/[0.05] text-white/50 border-white/10",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    data.whatsapp.status === "CONNECTED"
                      ? "bg-emerald-400 animate-pulse"
                      : data.whatsapp.status === "CONFIGURATION_INCOMPLETE"
                        ? "bg-amber-400"
                        : "bg-white/30",
                  )}
                />
                <span>{data.whatsapp.status.replace("_", " ")}</span>
              </div>
            </div>

            {/* Diagnostics checklist */}
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">
                Verification & Credentials
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 text-white/70">
                  {data.whatsapp.hasAccessToken ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="size-3.5 text-rose-400" />
                  )}
                  <span>Access Token</span>
                </div>
                <div className="flex items-center gap-1.5 text-white/70">
                  {data.whatsapp.hasAppSecret ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="size-3.5 text-rose-400" />
                  )}
                  <span>App Secret (HMAC)</span>
                </div>
                <div className="flex items-center gap-1.5 text-white/70">
                  {data.whatsapp.hasVerifyToken ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="size-3.5 text-rose-400" />
                  )}
                  <span>Verify Token</span>
                </div>
                <div className="flex items-center gap-1.5 text-white/70">
                  {data.whatsapp.phoneNumberId ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="size-3.5 text-amber-400" />
                  )}
                  <span>Inbox Registered</span>
                </div>
              </div>
            </div>

            {/* Webhook Endpoint */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                Meta Webhook Callback URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={data.whatsapp.webhookUrl}
                  className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11px] text-white/80 select-all"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(data.whatsapp.webhookUrl, "wa-url")}
                  className="border border-white/10 bg-white/[0.03] text-white/70 hover:text-white"
                >
                  {copiedKey === "wa-url" ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
            </div>

            {/* Organization Phone Number ID Form */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              <span className="text-xs font-semibold text-white/90">
                Tenant Phone Number ID Mapping
              </span>
              <p className="text-[11px] text-white/50 leading-relaxed">
                Enter your Meta Cloud API Phone Number ID (from the WhatsApp App dashboard) to bind inbound webhooks to this organization.
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="e.g. 104829374028472"
                  value={waPhoneId}
                  onChange={(e) => setWaPhoneId(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50 font-mono"
                />
                <input
                  type="text"
                  placeholder="Display Label (e.g. Primary Support WhatsApp)"
                  value={waLabel}
                  onChange={(e) => setWaLabel(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50"
                />
                <Button
                  size="sm"
                  onClick={() => handleSaveInbox("WHATSAPP")}
                  disabled={savingWa}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-medium text-xs shadow-md"
                >
                  {savingWa ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                  Save WhatsApp Configuration
                </Button>
              </div>
            </div>

            {/* Last Activity */}
            {data.whatsapp.lastWebhookAt && (
              <div className="pt-2 border-t border-white/5 text-[11px] text-white/40 flex justify-between">
                <span>Last webhook event:</span>
                <span className="font-mono text-white/70">{new Date(data.whatsapp.lastWebhookAt).toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* ── EMAIL INBOX CARD ── */}
          <div className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#08090d]/90 backdrop-blur-xl p-5 space-y-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                  <Mail className="size-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Inbound & Outbound Email</h2>
                  <p className="text-[11px] text-white/50">{data.email.provider} / Direct Webhook</p>
                </div>
              </div>

              <div
                className={cn(
                  "px-2.5 py-1 rounded-full text-[10px] font-mono font-medium flex items-center gap-1.5 border",
                  data.email.status === "CONNECTED"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : data.email.status === "CONFIGURATION_INCOMPLETE"
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      : "bg-white/[0.05] text-white/50 border-white/10",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    data.email.status === "CONNECTED"
                      ? "bg-emerald-400 animate-pulse"
                      : data.email.status === "CONFIGURATION_INCOMPLETE"
                        ? "bg-amber-400"
                        : "bg-white/30",
                  )}
                />
                <span>{data.email.status.replace("_", " ")}</span>
              </div>
            </div>

            {/* Diagnostics checklist */}
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">
                Verification & Credentials
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 text-white/70">
                  {data.email.hasApiKey ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                  ) : (
                    <CheckCircle2 className="size-3.5 text-blue-400" />
                  )}
                  <span>{data.email.hasApiKey ? "Resend API Key" : "Console Delivery"}</span>
                </div>
                <div className="flex items-center gap-1.5 text-white/70">
                  {data.email.hasWebhookSecret ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="size-3.5 text-white/40" />
                  )}
                  <span>Webhook Secret</span>
                </div>
                <div className="flex items-center gap-1.5 text-white/70">
                  {data.email.inboundMailbox ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="size-3.5 text-amber-400" />
                  )}
                  <span>Inbound Mailbox</span>
                </div>
                <div className="flex items-center gap-1.5 text-white/70">
                  <CheckCircle2 className="size-3.5 text-emerald-400" />
                  <span>Thread Headers</span>
                </div>
              </div>
            </div>

            {/* Webhook Endpoint */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                Inbound Email Webhook URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={data.email.webhookUrl}
                  className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11px] text-white/80 select-all"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(data.email.webhookUrl, "email-url")}
                  className="border border-white/10 bg-white/[0.03] text-white/70 hover:text-white"
                >
                  {copiedKey === "email-url" ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
            </div>

            {/* Organization Inbound Mailbox Form */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              <span className="text-xs font-semibold text-white/90">
                Inbound Mailbox Address Mapping
              </span>
              <p className="text-[11px] text-white/50 leading-relaxed">
                Enter your company receiving address (e.g. orders@yourcompany.com). Inbound emails sent to this address will automatically route to your conversations inbox.
              </p>
              <div className="space-y-2">
                <input
                  type="email"
                  placeholder="e.g. orders@acme-enterprises.com"
                  value={emailBox}
                  onChange={(e) => setEmailBox(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50 font-mono"
                />
                <input
                  type="text"
                  placeholder="Display Label (e.g. Sales & Orders Email)"
                  value={emailLabel}
                  onChange={(e) => setEmailLabel(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-red-500/50"
                />
                <Button
                  size="sm"
                  onClick={() => handleSaveInbox("EMAIL")}
                  disabled={savingEmail}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-medium text-xs shadow-md"
                >
                  {savingEmail ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                  Save Email Configuration
                </Button>
              </div>
            </div>

            {/* Last Activity */}
            {data.email.lastWebhookAt && (
              <div className="pt-2 border-t border-white/5 text-[11px] text-white/40 flex justify-between">
                <span>Last inbound email:</span>
                <span className="font-mono text-white/70">{new Date(data.email.lastWebhookAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Meta Webhook Verification Instructions */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#08090d]/90 p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-white/80 flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-400" />
          Production Webhook Verification & Security Architecture
        </h3>
        <p className="text-xs text-white/60 leading-relaxed">
          All inbound requests are strictly tenant-isolated. RF Intelligence verifies the authenticity of incoming payloads using HMAC-SHA256 signatures before reading any data. The tenant organization is resolved strictly via the registered <code className="text-white/80 bg-white/5 px-1 py-0.5 rounded">MessagingInbox</code> table lookup matching the business phone number or receiving email address.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-white/50 pt-2 font-mono">
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-white/80 font-sans font-semibold block mb-1">WhatsApp Cloud API</span>
            1. Meta Dashboard → WhatsApp → Configuration<br/>
            2. Webhook URL: <span className="text-emerald-400">{data?.whatsapp.webhookUrl || "..."}</span><br/>
            3. Verify Token: Set in <span className="text-amber-400">WHATSAPP_VERIFY_TOKEN</span><br/>
            4. Webhook field: Subscribe to <span className="text-blue-400">messages</span>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <span className="text-white/80 font-sans font-semibold block mb-1">Inbound Email Webhook</span>
            1. Email Provider (Resend / SendGrid / Postmark)<br/>
            2. Inbound Webhook URL: <span className="text-emerald-400">{data?.email.webhookUrl || "..."}</span><br/>
            3. HMAC Signature: <span className="text-amber-400">x-webhook-signature</span> header<br/>
            4. Format: JSON payload with <span className="text-blue-400">from, to, subject, text, html</span>
          </div>
        </div>
      </div>
    </div>
  );
}
