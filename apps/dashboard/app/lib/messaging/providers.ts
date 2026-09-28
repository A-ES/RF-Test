import type { CustomerConversationChannel } from "@rf-intelligence/db";
import type { MessagingProvider } from "@/app/lib/messaging/types";
import { whatsappProvider } from "@/app/lib/messaging/whatsapp";

/**
 * Resolve the outbound/inbound adapter for a conversation channel.
 * Ingest and the AI-reply job both go through here so a second channel is a
 * new provider module, not a fork of that logic.
 */
export function messagingProviderFor(
  channel: CustomerConversationChannel,
): MessagingProvider {
  if (channel === "EMAIL") {
    throw new Error("Email messaging provider is not configured yet");
  }
  return whatsappProvider;
}
