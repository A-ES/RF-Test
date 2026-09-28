import { inngest, CUSTOMER_MESSAGE_AI_EVENT } from "@/app/lib/inngest/client";
import type { NormalizedInboundMessage } from "@/app/lib/messaging/types";

const CLOSED_STATUSES = ["CLOSED", "RESOLVED"] as const;

export interface IngestResult {
  organizationId: string;
  customerId: string;
  conversationId: string;
  messageId: string;
  createdCustomer: boolean;
  duplicate: boolean;
}

export type IngestSkip = { skipped: "unknown_inbox" };

interface ConversationRow {
  id: string;
  status: string;
  customerId: string;
}

/**
 * Persistence surface ingest needs. Tests supply an in-memory stand-in;
 * production passes the Prisma client.
 */
export interface MessagingStore {
  messagingInbox: {
    findUnique: (args: {
      where: {
        provider_externalAddress: {
          provider: "WHATSAPP" | "EMAIL";
          externalAddress: string;
        };
      };
      select: { organizationId: true };
    }) => Promise<{ organizationId: string } | null>;
  };
  customer: {
    findFirst: (args: {
      where: Record<string, unknown>;
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: Record<string, unknown>;
      select: { id: true };
    }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: { lastInteractionAt: Date };
    }) => Promise<unknown>;
  };
  customerConversation: {
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy: { lastMessageAt: "desc" };
    }) => Promise<ConversationRow | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<ConversationRow>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  customerMessage: {
    findFirst: (args: {
      where: { organizationId: string; providerMessageId: string };
      select: {
        id: true;
        conversationId: true;
        conversation: { select: { customerId: true } };
      };
    }) => Promise<{
      id: string;
      conversationId: string;
      conversation: { customerId: string };
    } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
}

/**
 * Persist one inbound message and enqueue the AI-response job.
 *
 * Organization resolution:
 *   MessagingInbox where provider matches the channel and externalAddress
 *   equals `inboxIdentifier`. WhatsApp uses Meta `phone_number_id` as that
 *   address (one Cloud API number per organization). A later email provider
 *   will use the destination mailbox the same way. The webhook payload must
 *   not carry organizationId.
 */
export async function ingestInboundMessage(
  db: MessagingStore,
  message: NormalizedInboundMessage,
): Promise<IngestResult | IngestSkip> {
  const inbox = await db.messagingInbox.findUnique({
    where: {
      provider_externalAddress: {
        provider: inboxProvider(message.channel),
        externalAddress: message.inboxIdentifier,
      },
    },
    select: { organizationId: true },
  });

  if (!inbox) {
    console.warn(
      `messaging: no inbox for ${message.channel} ${message.inboxIdentifier}`,
    );
    return { skipped: "unknown_inbox" };
  }

  const organizationId = inbox.organizationId;
  const contact = normalizeContactIdentifier(
    message.channel,
    message.contactIdentifier,
  );

  if (message.providerMessageId) {
    const duplicate = await db.customerMessage.findFirst({
      where: {
        organizationId,
        providerMessageId: message.providerMessageId,
      },
      select: {
        id: true,
        conversationId: true,
        conversation: { select: { customerId: true } },
      },
    });
    if (duplicate) {
      return {
        organizationId,
        customerId: duplicate.conversation.customerId,
        conversationId: duplicate.conversationId,
        messageId: duplicate.id,
        createdCustomer: false,
        duplicate: true,
      };
    }
  }

  const { customer, createdCustomer } = await findOrCreateCustomer(
    db,
    organizationId,
    contact,
    message,
  );

  const conversation = await findOrCreateConversation(
    db,
    organizationId,
    customer.id,
    message,
  );

  const preview =
    message.body.length > 180 ? `${message.body.slice(0, 177)}...` : message.body;

  const created = await db.customerMessage.create({
    data: {
      organizationId,
      conversationId: conversation.id,
      sender: "CUSTOMER",
      body: message.body,
      providerMessageId: message.providerMessageId,
      createdAt: message.receivedAt,
    },
  });

  await db.customerConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: message.receivedAt,
      lastMessagePreview: preview,
      status:
        conversation.status === "WAITING_FOR_CUSTOMER"
          ? "AI_HANDLING"
          : conversation.status,
    },
  });

  await db.customer.update({
    where: { id: customer.id },
    data: { lastInteractionAt: message.receivedAt },
  });

  await inngest.send({
    name: CUSTOMER_MESSAGE_AI_EVENT,
    data: {
      organizationId,
      customerId: customer.id,
      conversationId: conversation.id,
      messageId: created.id,
    },
  });

  return {
    organizationId,
    customerId: customer.id,
    conversationId: conversation.id,
    messageId: created.id,
    createdCustomer,
    duplicate: false,
  };
}

export async function ingestInboundMessages(
  db: MessagingStore,
  messages: NormalizedInboundMessage[],
): Promise<Array<IngestResult | IngestSkip>> {
  const results = [];
  for (const message of messages) {
    results.push(await ingestInboundMessage(db, message));
  }
  return results;
}

export function normalizeContactIdentifier(
  channel: NormalizedInboundMessage["channel"],
  raw: string,
): string {
  if (channel === "EMAIL") {
    return raw.trim().toLowerCase();
  }
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw.trim();
  return `+${digits.replace(/^00/, "")}`;
}

function inboxProvider(
  channel: NormalizedInboundMessage["channel"],
): "WHATSAPP" | "EMAIL" {
  return channel === "EMAIL" ? "EMAIL" : "WHATSAPP";
}

async function findOrCreateCustomer(
  db: MessagingStore,
  organizationId: string,
  contact: string,
  message: NormalizedInboundMessage,
): Promise<{ customer: { id: string }; createdCustomer: boolean }> {
  const existing = await db.customer.findFirst({
    where: {
      organizationId,
      OR: [{ whatsapp: contact }, { phone: contact }],
    },
    select: { id: true },
  });
  if (existing) return { customer: existing, createdCustomer: false };

  try {
    const created = await db.customer.create({
      data: {
        organizationId,
        name: message.contactDisplayName?.trim() || contact,
        phone: contact,
        whatsapp: contact,
        status: "LEAD",
        tagsJson: JSON.stringify(["inbound", message.channel.toLowerCase()]),
        lastInteractionAt: message.receivedAt,
      },
      select: { id: true },
    });
    return { customer: created, createdCustomer: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db.customer.findFirst({
      where: { organizationId, whatsapp: contact },
      select: { id: true },
    });
    if (!raced) throw error;
    return { customer: raced, createdCustomer: false };
  }
}

async function findOrCreateConversation(
  db: MessagingStore,
  organizationId: string,
  customerId: string,
  message: NormalizedInboundMessage,
): Promise<ConversationRow> {
  const open = await db.customerConversation.findFirst({
    where: {
      organizationId,
      customerId,
      channel: message.channel,
      status: { notIn: [...CLOSED_STATUSES] },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  if (open) return open;

  return db.customerConversation.create({
    data: {
      organizationId,
      customerId,
      channel: message.channel,
      status: "AI_HANDLING",
      priority: "NORMAL",
      tagsJson: JSON.stringify(["inbound"]),
      lastMessageAt: message.receivedAt,
      lastMessagePreview: message.body.slice(0, 180),
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}
