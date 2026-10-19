import { prisma } from "@/app/lib/db";
import type { MessagingProvider, OutboundMessage, NormalizedInboundMessage } from "@/app/lib/messaging/types";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";

/**
 * Ensures a DEMO MessagingInbox exists for an organization.
 */
export async function ensureDemoInbox(organizationId: string) {
  const externalAddress = `demo-inbox-${organizationId}`;
  return prisma.messagingInbox.upsert({
    where: {
      provider_externalAddress: {
        provider: "DEMO",
        externalAddress,
      },
    },
    create: {
      organizationId,
      provider: "DEMO",
      externalAddress,
      displayLabel: "Demo Virtual Channel",
    },
    update: {},
  });
}

/**
 * DemoProvider implements the MessagingProvider interface.
 *
 * Outbound sends only write the CustomerMessage (and publish the Ably event);
 * nothing leaves the app (no external API calls or HTTP tunnels).
 */
export const demoProvider: MessagingProvider = {
  name: "demo",

  async parseInbound(rawBody: string): Promise<NormalizedInboundMessage[]> {
    try {
      const parsed = JSON.parse(rawBody);
      if (Array.isArray(parsed)) return parsed as NormalizedInboundMessage[];
      if (parsed && typeof parsed === "object") {
        return [parsed as NormalizedInboundMessage];
      }
      return [];
    } catch {
      return [];
    }
  },

  async sendOutbound(message: OutboundMessage): Promise<{ providerMessageId: string }> {
    // 1. Resolve organizationId from inboxIdentifier
    let organizationId: string | undefined;
    const inbox = await prisma.messagingInbox.findFirst({
      where: {
        provider: "DEMO",
        externalAddress: message.inboxIdentifier,
      },
      select: { organizationId: true },
    });

    if (inbox) {
      organizationId = inbox.organizationId;
    } else if (message.inboxIdentifier.startsWith("demo-inbox-")) {
      organizationId = message.inboxIdentifier.replace("demo-inbox-", "");
    }

    if (!organizationId) {
      throw new Error(
        `DemoProvider: Unable to resolve organization for inboxIdentifier: ${message.inboxIdentifier}`,
      );
    }

    // 2. Resolve customer and conversation
    const customer = await prisma.customer.findFirst({
      where: {
        organizationId,
        OR: [
          { phone: message.contactIdentifier },
          { whatsapp: message.contactIdentifier },
          { email: message.contactIdentifier },
        ],
      },
      select: { id: true, name: true },
    });

    let conversation = await prisma.customerConversation.findFirst({
      where: {
        organizationId,
        channel: "DEMO",
        ...(customer ? { customerId: customer.id } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!conversation) {
      let customerId = customer?.id;
      if (!customerId) {
        const newCust = await prisma.customer.create({
          data: {
            organizationId,
            name: "Demo Customer",
            phone: message.contactIdentifier.startsWith("+")
              ? message.contactIdentifier
              : `+${message.contactIdentifier.replace(/\D/g, "")}` || "+15550000000",
            status: "ACTIVE",
            tagsJson: JSON.stringify(["demo"]),
          },
          select: { id: true },
        });
        customerId = newCust.id;
      }

      conversation = await prisma.customerConversation.create({
        data: {
          organizationId,
          customerId,
          channel: "DEMO",
          status: "WAITING_FOR_CUSTOMER",
          tagsJson: JSON.stringify(["demo"]),
        },
      });
    }

    const providerMessageId = `demo_msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();

    // Check if the caller already wrote this message just now (e.g. ai-reply or customer-updates)
    const existing = await prisma.customerMessage.findFirst({
      where: {
        organizationId,
        conversationId: conversation.id,
        body: message.body,
        createdAt: { gte: new Date(Date.now() - 4000) },
      },
    });

    let savedMessageId: string;

    if (existing) {
      savedMessageId = existing.id;
      if (!existing.providerMessageId) {
        await prisma.customerMessage.update({
          where: { id: existing.id },
          data: { providerMessageId },
        });
      }
    } else {
      const created = await prisma.customerMessage.create({
        data: {
          organizationId,
          conversationId: conversation.id,
          sender: "AI",
          body: message.body,
          providerMessageId,
          createdAt: now,
        },
      });
      savedMessageId = created.id;

      await prisma.customerConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: now,
          lastMessagePreview:
            message.body.length > 180 ? `${message.body.slice(0, 177)}...` : message.body,
        },
      });
    }

    // Publish to Ably channel so customer UI / admin thread updates in realtime
    await publishToChannel(
      orgChannel(organizationId, "messages"),
      REALTIME_EVENTS.messageCreated,
      {
        conversationId: conversation.id,
        messageId: savedMessageId,
        message: {
          id: savedMessageId,
          conversationId: conversation.id,
          sender: existing?.sender ?? "AI",
          body: message.body,
          providerMessageId,
          createdAt: now.toISOString(),
        },
      },
    );

    return { providerMessageId };
  },
};
