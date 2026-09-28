import type { CustomerConversationChannel } from "@rf-intelligence/db";

/**
 * Channel-agnostic inbound message after a MessagingProvider has parsed the
 * vendor payload. Ingest (find/create customer, conversation, message, enqueue
 * AI) operates only on this shape so a second channel does not change it.
 */
export interface NormalizedInboundMessage {
  channel: CustomerConversationChannel;
  /**
   * Inbox that maps 1:1 onto an organization. WhatsApp: Meta
   * `metadata.phone_number_id`. Email (later): destination mailbox.
   */
  inboxIdentifier: string;
  /** Customer contact id. WhatsApp: sender MSISDN. Email: From address. */
  contactIdentifier: string;
  contactDisplayName?: string;
  body: string;
  providerMessageId?: string;
  receivedAt: Date;
}

export interface OutboundMessage {
  inboxIdentifier: string;
  contactIdentifier: string;
  body: string;
}

export interface MessagingProvider {
  readonly name: string;
  /**
   * Parse a raw HTTP body into zero or more inbound messages. Status callbacks
   * and empty payloads return []. Must not persist or call the model.
   */
  parseInbound(rawBody: string): NormalizedInboundMessage[];
  sendOutbound(message: OutboundMessage): Promise<{ providerMessageId?: string }>;
}
