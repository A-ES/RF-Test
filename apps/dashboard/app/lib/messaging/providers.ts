import type { CustomerConversationChannel } from "@rf-intelligence/db";
import type { MessagingProvider } from "@/app/lib/messaging/types";
export type { MessagingProvider } from "@/app/lib/messaging/types";
import { whatsappProvider } from "@/app/lib/messaging/whatsapp";

const overrides = new Map<CustomerConversationChannel, MessagingProvider>();

/**
 * Test seam to inject a mock messaging provider for a channel.
 */
export function setMessagingProviderFor(
  channel: CustomerConversationChannel,
  provider: MessagingProvider | null,
): void {
  if (provider) {
    overrides.set(channel, provider);
  } else {
    overrides.delete(channel);
  }
}

/**
 * Resolve the outbound/inbound adapter for a conversation channel.
 * Ingest and the AI-reply job both go through here so a second channel is a
 * new provider module, not a fork of that logic.
 */
import { sendEmail } from "@/app/lib/email";

export const emailMessagingProvider: MessagingProvider = {
  name: "email",
  async parseInbound() {
    return [];
  },
  async sendOutbound(msg) {
    const res = await sendEmail({
      to: msg.contactIdentifier,
      subject: "Update from RF Intelligence",
      body: msg.body,
    });
    return {
      providerMessageId: `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  },
};

import { demoProvider } from "@/app/lib/messaging/demo";

export function messagingProviderFor(
  channel: CustomerConversationChannel,
): MessagingProvider {
  if (overrides.has(channel)) {
    return overrides.get(channel)!;
  }
  if (channel === "DEMO") {
    return demoProvider;
  }
  if (channel === "EMAIL") {
    return emailMessagingProvider;
  }
  if (channel === "WHATSAPP") {
    return whatsappProvider;
  }
  // Clear error: channel not enabled for SMS and WEB_CHAT
  throw new Error(`Channel not enabled: ${channel}`);
}
