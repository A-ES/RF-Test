import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedInboundMessage, OutboundMessage, MessagingProvider } from "./types";
import { sendEmail } from "@/app/lib/email";

/**
 * Enterprise Email Messaging Provider for Inbound and Outbound.
 *
 * Supports:
 * - Inbound Webhook parsing (Resend, SendGrid, Postmark, or generic JSON inbound)
 * - HMAC-SHA256 signature verification via EMAIL_WEBHOOK_SECRET
 * - Header extraction: Message-ID, In-Reply-To, References, Subject
 * - Thread continuity: Matching replies back to existing conversations
 * - Safe HTML body sanitization
 * - Outbound delivery via Resend API or console fallback
 */

export interface InboundEmailPayload {
  from: string;
  to: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    contentType: string;
    content?: string;
    url?: string;
    size?: number;
  }>;
  timestamp?: string | number;
}

/**
 * Sanitizes HTML to plain text or safe tags, removing scripts, stylesheets, and dangerous event handlers.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return "";
  // Strip script, style, iframe, object, embed tags with contents
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  clean = clean.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "");
  
  // Remove event handlers like onclick, onload, etc.
  clean = clean.replace(/\son\w+="[^"]*"/gi, "");
  clean = clean.replace(/\son\w+='[^']*'/gi, "");
  clean = clean.replace(/\son\w+=\w+/gi, "");

  // Remove javascript: URLs
  clean = clean.replace(/href=["']javascript:[^"']*["']/gi, 'href="#"');

  return clean;
}

/**
 * Extracts clean plain text from email HTML if plain text version is missing.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Verifies email webhook signature (HMAC-SHA256).
 */
export function verifyEmailWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!secret) return true; // If no secret configured in dev mode, permit
  if (!signatureHeader) return false;

  const cleanSig = signatureHeader.replace(/^sha256=/, "").trim();
  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");

  const expected = Buffer.from(expectedHex, "utf8");
  const actual = Buffer.from(cleanSig, "utf8");

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Parse an incoming webhook into NormalizedInboundMessage[].
 */
export function parseInboundEmailPayload(rawBody: string): NormalizedInboundMessage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }

  // Handle single item or array of items (like SendGrid batches)
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const results: NormalizedInboundMessage[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    // 1. Resolve 'From' / Sender
    let from = "";
    let displayName = "";
    const rawFrom = typeof rec.from === "string" ? rec.from : "";
    if (rawFrom) {
      const match = rawFrom.match(/^(?:["']?([^"']+)["']?\s+)?<?([^>]+@[^>]+)>?$/);
      if (match) {
        displayName = (match[1] || "").trim();
        from = match[2].trim().toLowerCase();
      } else {
        from = rawFrom.trim().toLowerCase();
      }
    } else if (typeof rec.sender === "string") {
      from = rec.sender.trim().toLowerCase();
    }

    if (!from) continue;

    // 2. Resolve 'To' / Destination Mailbox (maps to MessagingInbox.externalAddress)
    let to = "";
    if (typeof rec.to === "string") {
      to = rec.to.trim().toLowerCase();
    } else if (Array.isArray(rec.to) && rec.to.length > 0) {
      to = String(rec.to[0]).trim().toLowerCase();
    } else if (typeof rec.recipient === "string") {
      to = rec.recipient.trim().toLowerCase();
    }

    // Clean brackets e.g. "Support <support@myorg.com>" -> "support@myorg.com"
    const toMatch = to.match(/<([^>]+@[^>]+)>/);
    if (toMatch) {
      to = toMatch[1].trim().toLowerCase();
    }

    if (!to) continue;

    // 3. Subject and Body
    const subject = typeof rec.subject === "string" ? rec.subject.trim() : "";
    let body = typeof rec.text === "string" && rec.text.trim() ? rec.text.trim() : "";
    const rawHtml = typeof rec.html === "string" ? rec.html : "";

    if (!body && rawHtml) {
      body = htmlToPlainText(rawHtml);
    }

    if (!body && subject) {
      body = subject;
    }

    if (!body) {
      body = "[Empty email received]";
    }

    // 4. Thread Headers (Message-ID, In-Reply-To, References)
    const headers = (rec.headers && typeof rec.headers === "object") ? (rec.headers as Record<string, string>) : {};
    const messageId =
      (typeof rec.messageId === "string" ? rec.messageId : null) ||
      (typeof rec["message-id"] === "string" ? rec["message-id"] : null) ||
      headers["message-id"] ||
      headers["Message-ID"] ||
      `email_msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const inReplyTo =
      (typeof rec.inReplyTo === "string" ? rec.inReplyTo : null) ||
      (typeof rec["in-reply-to"] === "string" ? rec["in-reply-to"] : null) ||
      headers["in-reply-to"] ||
      headers["In-Reply-To"] ||
      null;

    const references =
      (typeof rec.references === "string" ? rec.references : null) ||
      headers["references"] ||
      headers["References"] ||
      null;

    const emailHeadersJson = JSON.stringify({
      messageId,
      inReplyTo,
      references,
      subject,
      headers,
    });

    // 5. Attachments
    const attachmentsJson = Array.isArray(rec.attachments)
      ? JSON.stringify(rec.attachments)
      : "[]";

    // 6. Timestamp
    const rawTs = rec.timestamp;
    const receivedAt =
      typeof rawTs === "number"
        ? new Date(rawTs * 1000)
        : typeof rawTs === "string"
          ? new Date(rawTs)
          : new Date();

    results.push({
      channel: "EMAIL",
      inboxIdentifier: to,
      contactIdentifier: from,
      contactDisplayName: displayName || undefined,
      body,
      attachmentsJson,
      providerMessageId: messageId,
      emailSubject: subject || undefined,
      emailHeadersJson,
      receivedAt,
    });
  }

  return results;
}

/**
 * Enterprise Outbound Email Delivery implementation.
 */
export async function sendOutboundEmail(message: OutboundMessage): Promise<{ providerMessageId?: string }> {
  const emailSubject = message.emailSubject || "Update regarding your inquiry";

  // Deliver via configured email provider (SMTP / console)
  const result = await sendEmail({
    to: message.contactIdentifier,
    subject: emailSubject,
    body: message.body,
    from: message.inboxIdentifier,
  });

  if (!result.delivered) {
    throw new Error(`Email delivery failed: ${result.error || "Unknown delivery error"}`);
  }

  const providerMessageId = result.providerMessageId || `email_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  return { providerMessageId };
}

/**
 * Exported Email Messaging Provider implementing the MessagingProvider interface.
 */
export const emailMessagingProvider: MessagingProvider = {
  name: "email",
  async parseInbound(rawBody: string): Promise<NormalizedInboundMessage[]> {
    return parseInboundEmailPayload(rawBody);
  },
  async sendOutbound(message: OutboundMessage): Promise<{ providerMessageId?: string }> {
    return sendOutboundEmail(message);
  },
};
