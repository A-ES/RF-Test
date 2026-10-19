import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedInboundMessage } from "@/app/lib/messaging/types";
import type { MessagingProvider } from "@/app/lib/messaging/types";
import {
  getMediaStorageBucket,
  getTranscriber,
} from "@/app/lib/messaging/transcriber";

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

export interface WhatsAppMediaFetcher {
  fetchMedia(
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename?: string }>;
}

let activeMediaFetcher: WhatsAppMediaFetcher | null = null;

/**
 * Test seam to inject a mock media fetcher.
 */
export function setWhatsAppMediaFetcher(
  fetcher: WhatsAppMediaFetcher | null,
): void {
  activeMediaFetcher = fetcher;
}

/**
 * Download media binary via Meta Graph API.
 */
export async function fetchMetaMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string; filename?: string }> {
  if (activeMediaFetcher) {
    return activeMediaFetcher.fetchMedia(mediaId);
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "WHATSAPP_ACCESS_TOKEN is not configured: cannot fetch inbound media from Meta Graph API",
    );
  }

  const metaUrlRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!metaUrlRes.ok) {
    const detail = await metaUrlRes.text().catch(() => "");
    throw new Error(
      `Meta media metadata fetch failed (${metaUrlRes.status}): ${detail.slice(0, 300)}`,
    );
  }

  const metaData = (await metaUrlRes.json()) as {
    url?: string;
    mime_type?: string;
  };
  if (!metaData.url) {
    throw new Error(
      `Meta media response did not include download URL for ${mediaId}`,
    );
  }

  const downloadRes = await fetch(metaData.url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!downloadRes.ok) {
    throw new Error(`Meta media download failed (${downloadRes.status})`);
  }

  const arrayBuf = await downloadRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    mimeType: metaData.mime_type || "application/octet-stream",
    filename: `${mediaId}`,
  };
}

export const whatsappProvider: MessagingProvider = {
  name: "whatsapp",
  async parseInbound(rawBody: string): Promise<NormalizedInboundMessage[]> {
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
          if (!from) continue;

          let body: string | null = null;
          let transcript: string | undefined;
          let attachmentsJson: string = "[]";

          const itemType = typeof item.type === "string" ? item.type : "";

          if (itemType === "text") {
            body = textBody(item);
          } else if (itemType === "audio" || itemType === "voice") {
            const audioObj = isRecord(item.audio)
              ? item.audio
              : isRecord(item.voice)
                ? item.voice
                : null;
            const mediaId =
              typeof audioObj?.id === "string" ? audioObj.id.trim() : "";
            if (mediaId) {
              const { buffer, mimeType, filename } =
                await fetchMetaMedia(mediaId);
              const bucketKey = `audio/${phoneNumberId}/${mediaId}.ogg`;
              const stored = await getMediaStorageBucket().store(
                bucketKey,
                buffer,
                mimeType,
              );

              const transcriber = getTranscriber();
              transcript = await transcriber.transcribe({
                buffer,
                mimeType,
                filename: filename || `${mediaId}.ogg`,
              });

              body = transcript || "[Voice note]";
              attachmentsJson = JSON.stringify([
                {
                  type: "audio",
                  id: mediaId,
                  url: stored.url,
                  mimeType,
                },
              ]);
            }
          } else if (itemType === "image" && isRecord(item.image)) {
            const mediaId =
              typeof item.image.id === "string" ? item.image.id.trim() : "";
            const caption =
              typeof item.image.caption === "string"
                ? item.image.caption.trim()
                : "";
            const mimeType =
              typeof item.image.mime_type === "string"
                ? item.image.mime_type
                : "image/jpeg";
            body = caption || "[Image]";
            attachmentsJson = JSON.stringify([
              {
                type: "image",
                id: mediaId,
                mimeType,
                caption: caption || undefined,
              },
            ]);
          } else if (itemType === "document" && isRecord(item.document)) {
            const mediaId =
              typeof item.document.id === "string"
                ? item.document.id.trim()
                : "";
            const caption =
              typeof item.document.caption === "string"
                ? item.document.caption.trim()
                : "";
            const filename =
              typeof item.document.filename === "string"
                ? item.document.filename.trim()
                : "";
            const mimeType =
              typeof item.document.mime_type === "string"
                ? item.document.mime_type
                : "application/pdf";
            body = caption || filename || "[Document]";
            attachmentsJson = JSON.stringify([
              {
                type: "document",
                id: mediaId,
                mimeType,
                filename: filename || undefined,
                caption: caption || undefined,
              },
            ]);
          }

          if (!body) continue;

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
            attachmentsJson,
            transcript,
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
      throw new Error(
        "WhatsApp outbound requires inboxIdentifier and contactIdentifier",
      );
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

export interface WhatsAppStatusUpdate {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  recipientId?: string;
  error?: string;
}

/**
 * Extracts delivery status callbacks from WhatsApp webhook payload.
 */
export function parseWhatsAppStatuses(rawBody: string): WhatsAppStatusUpdate[] {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(payload) || payload.object !== "whatsapp_business_account") {
    return [];
  }
  const updates: WhatsAppStatusUpdate[] = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const statuses = Array.isArray(change.value.statuses) ? change.value.statuses : [];
      for (const item of statuses) {
        if (!isRecord(item)) continue;
        const id = typeof item.id === "string" ? item.id : "";
        const status = typeof item.status === "string" ? item.status : "";
        if (id && status) {
          updates.push({
            providerMessageId: id,
            status: status as WhatsAppStatusUpdate["status"],
            timestamp: new Date(Number(item.timestamp || Date.now()) * 1000),
            recipientId: typeof item.recipient_id === "string" ? item.recipient_id : undefined,
            error: Array.isArray(item.errors) && item.errors.length > 0 ? JSON.stringify(item.errors) : undefined,
          });
        }
      }
    }
  }
  return updates;
}

