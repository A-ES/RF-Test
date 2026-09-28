import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedInboundMessage } from "@/app/lib/messaging/types";
import type { MessagingProvider } from "@/app/lib/messaging/types";

/**
 * WhatsApp Cloud API (Meta) inbound adapter.
 *
 * Organization resolution (not done here — ingest looks this up):
 *   `value.metadata.phone_number_id` → MessagingInbox.externalAddress
 *   where provider = WHATSAPP. That row's organizationId is the tenant.
 *   Configure one Cloud API phone number (and thus one phone_number_id) per
 *   client organization. Do not put organizationId on the webhook URL.
 */
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export const whatsappProvider: MessagingProvider = {
  name: "whatsapp",
  parseInbound(rawBody: string): NormalizedInboundMessage[] {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      return [];
    }
    if (!isRecord(payload) || payload.object !== "whatsapp_business_account") {
      return [];
    }

    const messages: NormalizedInboundMessage[] = [];
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        if (!isRecord(change) || !isRecord(change.value)) continue;
        const value = change.value;
        const metadata = isRecord(value.metadata) ? value.metadata : {};
        const phoneNumberId =
          typeof metadata.phone_number_id === "string"
            ? metadata.phone_number_id.trim()
            : "";
        if (!phoneNumberId) continue;

        const nameByWaId = contactNames(value.contacts);
        const inbound = Array.isArray(value.messages) ? value.messages : [];

        for (const item of inbound) {
          if (!isRecord(item)) continue;
          const from = typeof item.from === "string" ? item.from.trim() : "";
          const body = textBody(item);
          if (!from || !body) continue;

          const timestampSec =
            typeof item.timestamp === "string"
              ? Number(item.timestamp)
              : typeof item.timestamp === "number"
                ? item.timestamp
                : NaN;
          const receivedAt = Number.isFinite(timestampSec)
            ? new Date(timestampSec * 1000)
            : new Date();

          messages.push({
            channel: "WHATSAPP",
            inboxIdentifier: phoneNumberId,
            contactIdentifier: from,
            contactDisplayName: nameByWaId.get(from),
            body,
            providerMessageId:
              typeof item.id === "string" && item.id.length > 0
                ? item.id
                : undefined,
            receivedAt,
          });
        }
      }
    }

    return messages;
  },

  async sendOutbound(message) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    if (!token) {
      throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
    }
    const phoneNumberId = message.inboxIdentifier.trim();
    const to = message.contactIdentifier.replace(/\D/g, "");
    if (!phoneNumberId || !to) {
      throw new Error("WhatsApp outbound requires inboxIdentifier and contactIdentifier");
    }

    const response = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message.body, preview_url: false },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `WhatsApp send failed (${response.status}): ${detail.slice(0, 400)}`,
      );
    }

    const data = (await response.json()) as {
      messages?: Array<{ id?: string }>;
    };
    return { providerMessageId: data.messages?.[0]?.id };
  },
};

export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const expectedHex = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length);
  const expected = Buffer.from(expectedHex, "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function signWhatsAppBody(rawBody: string, appSecret: string): string {
  const hex = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return `sha256=${hex}`;
}

function contactNames(contacts: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(contacts)) return map;
  for (const contact of contacts) {
    if (!isRecord(contact)) continue;
    const waId = typeof contact.wa_id === "string" ? contact.wa_id : "";
    const profile = isRecord(contact.profile) ? contact.profile : {};
    const name = typeof profile.name === "string" ? profile.name.trim() : "";
    if (waId && name) map.set(waId, name);
  }
  return map;
}

function textBody(item: Record<string, unknown>): string | null {
  if (item.type === "text" && isRecord(item.text)) {
    const body = item.text.body;
    return typeof body === "string" && body.trim() ? body.trim() : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
