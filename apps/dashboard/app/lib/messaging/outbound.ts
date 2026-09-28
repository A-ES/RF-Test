import { prisma } from "@/app/lib/db";
import { messagingProviderFor } from "@/app/lib/messaging/providers";
import type { CustomerConversationChannel } from "@rf-intelligence/db";

/**
 * Resolves the outbound addressing for a customer conversation.
 *
 * Returns the two identifiers `sendOutbound` needs:
 *   - `inboxIdentifier` — the org's business number / mailbox (e.g. Meta
 *     `phone_number_id` for WhatsApp). Retrieved from the MessagingInbox row
 *     that the organization registered for this channel.
 *   - `contactIdentifier` — the customer's contact address on that channel
 *     (WhatsApp MSISDN, email address, …).
 *
 * Throws when there is no configured inbox for this channel, or when the
 * customer has no contact address on it, so callers get a clear error instead
 * of silently sending to an empty string.
 */
export async function resolveOutboundAddressing(
  organizationId: string,
  conversationId: string,
): Promise<{
  inboxIdentifier: string;
  contactIdentifier: string;
  channel: CustomerConversationChannel;
}> {
  const conversation = await prisma.customerConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: {
      channel: true,
      customer: {
        select: { whatsapp: true, email: true, phone: true },
      },
    },
  });

  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  const { channel, customer } = conversation;

  // ------------------------------------------------------------------
  // 1. Inbox identifier — look up the org's registered provider address
  // ------------------------------------------------------------------
  const providerKind = channelToProviderKind(channel);
  const inbox = await prisma.messagingInbox.findFirst({
    where: { organizationId, provider: providerKind },
    select: { externalAddress: true },
  });

  if (!inbox) {
    throw new Error(
      `No ${providerKind} inbox configured for organization ${organizationId}`,
    );
  }

  // ------------------------------------------------------------------
  // 2. Contact identifier — pick the right field from the customer row
  // ------------------------------------------------------------------
  const contactIdentifier = resolveContactIdentifier(channel, customer);
  if (!contactIdentifier) {
    throw new Error(
      `Customer has no ${channel} contact address on file`,
    );
  }

  // Smoke-test the provider is implemented (throws for unimplemented ones)
  messagingProviderFor(channel);

  return { inboxIdentifier: inbox.externalAddress, contactIdentifier, channel };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelToProviderKind(
  channel: CustomerConversationChannel,
): "WHATSAPP" | "EMAIL" {
  switch (channel) {
    case "WHATSAPP":
      return "WHATSAPP";
    case "EMAIL":
      return "EMAIL";
    default:
      // WEB_CHAT / SMS — no provider-kind mapping yet
      throw new Error(`Outbound delivery is not supported for channel ${channel}`);
  }
}

function resolveContactIdentifier(
  channel: CustomerConversationChannel,
  customer: { whatsapp: string | null; email: string | null; phone: string | null },
): string | null {
  switch (channel) {
    case "WHATSAPP":
      return customer.whatsapp ?? customer.phone ?? null;
    case "EMAIL":
      return customer.email ?? null;
    default:
      return null;
  }
}
