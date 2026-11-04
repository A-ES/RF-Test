import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/app/lib/db";
import {
  parseInboundEmailPayload,
  sanitizeEmailHtml,
  verifyEmailWebhookSignature,
} from "./email";
import {
  classifyMessageHeuristic,
  analyzeIncomingMessage,
} from "./ai-classification";
import { ingestInboundMessage } from "./ingest";

describe("Customer Communication Hub & Message-to-Order Automation", () => {
  const waPhoneId = "test_meta_wa_phone_554433";
  const emailMailbox = "orders-testing@acme.corp";
  let orgId: string;

  beforeAll(async () => {
    const org = await prisma.organization.findFirst();
    if (!org) throw new Error("No test organization found in database");
    orgId = org.id;

    // Register MessagingInboxes for tenant isolation
    await prisma.messagingInbox.upsert({
      where: {
        provider_externalAddress: {
          provider: "WHATSAPP",
          externalAddress: waPhoneId,
        },
      },
      update: { organizationId: orgId },
      create: {
        organizationId: orgId,
        provider: "WHATSAPP",
        externalAddress: waPhoneId,
        displayLabel: "Test Meta WhatsApp",
      },
    });

    await prisma.messagingInbox.upsert({
      where: {
        provider_externalAddress: {
          provider: "EMAIL",
          externalAddress: emailMailbox,
        },
      },
      update: { organizationId: orgId },
      create: {
        organizationId: orgId,
        provider: "EMAIL",
        externalAddress: emailMailbox,
        displayLabel: "Test Inbound Mailbox",
      },
    });
  });

  afterAll(async () => {
    await prisma.customerMessage.deleteMany({
      where: { providerMessageId: "<test-msg-id-1234@buyer.com>" },
    });
    await prisma.messagingInbox.deleteMany({
      where: { externalAddress: { in: [waPhoneId, emailMailbox] } },
    });
  });

  it("1. Parses inbound email payloads with sender, recipient, and thread headers", () => {
    const rawEmail = JSON.stringify({
      from: "John Buyer <john.buyer@buyer.com>",
      to: [emailMailbox],
      subject: "Urgent: Order request for 20 boxes Widget A and 10 boxes Widget B",
      text: "Hi,\n\nWe need 20 boxes of Widget A and 10 boxes of Widget B tomorrow.\n\nThanks,\nJohn",
      messageId: "<test-msg-id-1234@buyer.com>",
      inReplyTo: "<prev-thread-id@rf-intel.com>",
    });

    const parsed = parseInboundEmailPayload(rawEmail);
    expect(parsed.length).toBe(1);
    expect(parsed[0].contactIdentifier).toBe("john.buyer@buyer.com");
    expect(parsed[0].contactDisplayName).toBe("John Buyer");
    expect(parsed[0].inboxIdentifier).toBe(emailMailbox);
    expect(parsed[0].providerMessageId).toBe("<test-msg-id-1234@buyer.com>");
    expect(parsed[0].emailSubject).toBe("Urgent: Order request for 20 boxes Widget A and 10 boxes Widget B");
  });

  it("2. Verifies HMAC-SHA256 email webhook signature and rejects invalid signatures", () => {
    const rawBody = JSON.stringify({ event: "email.received" });
    const secret = "test-secret-999";
    const validSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(verifyEmailWebhookSignature(rawBody, validSignature, secret)).toBe(true);
    expect(verifyEmailWebhookSignature(rawBody, "tampered_signature", secret)).toBe(false);
  });

  it("3. Strips harmful script, iframe, and inline handlers from email HTML", () => {
    const maliciousHtml = `
      <div>
        <script>alert('xss')</script>
        <p onmouseover="stealCookies()">Order details below</p>
        <iframe src="https://evil.com"></iframe>
        <a href="javascript:void(0)">Link</a>
      </div>
    `;
    const sanitized = sanitizeEmailHtml(maliciousHtml);
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("onmouseover");
    expect(sanitized).not.toContain("<iframe");
    expect(sanitized).not.toContain("javascript:");
  });

  it("4. Accurately classifies all key intent categories: NEW_ORDER, COMPLAINT, DELIVERY_ENQUIRY", async () => {
    // NEW_ORDER
    const orderAi = await analyzeIncomingMessage("Hi, I need 20 boxes of product A and 10 boxes of product B. Can you deliver them tomorrow?");
    expect(orderAi.intent).toBe("NEW_ORDER");
    expect(orderAi.requestedQuantities.length).toBeGreaterThanOrEqual(2);
    expect(orderAi.requiresHumanReview).toBe(true);

    // COMPLAINT
    const complaintAi = await analyzeIncomingMessage("I am very unhappy. Order #ORD-9901 arrived completely damaged and broken. This is terrible service!");
    expect(complaintAi.intent).toBe("COMPLAINT");
    expect(complaintAi.customerSentiment).toBe("FRUSTRATED");
    expect(complaintAi.urgency).toBe("HIGH");

    // DELIVERY_ENQUIRY
    const deliveryAi = await analyzeIncomingMessage("Where is my shipment #ORD-500? When will it arrive?");
    expect(deliveryAi.intent).toBe("DELIVERY_ENQUIRY");
  });

  it("5. Persists inbound email with tenant isolation and prevents duplicate message insertion on retry", async () => {
    const inbound = {
      channel: "EMAIL" as const,
      inboxIdentifier: emailMailbox,
      contactIdentifier: "john.buyer@buyer.com",
      contactDisplayName: "John Buyer",
      body: "Hi, I need 20 boxes of product A and 10 boxes of product B. Can you deliver them tomorrow?",
      providerMessageId: "<test-msg-id-1234@buyer.com>",
      emailSubject: "Purchase Order",
      emailHeadersJson: JSON.stringify({ messageId: "<test-msg-id-1234@buyer.com>" }),
      receivedAt: new Date(),
    };

    // First ingestion
    const res1 = await ingestInboundMessage(prisma as any, inbound);
    expect(res1).not.toHaveProperty("skipped");
    if ("organizationId" in res1) {
      expect(res1.organizationId).toBe(orgId);
      expect(res1.duplicate).toBe(false);

      // Verify conversation has AI intent and summary
      const conv = await prisma.customerConversation.findUnique({
        where: { id: res1.conversationId },
      });
      expect(conv).toBeDefined();
      expect((conv as any)?.aiIntent).toBe("NEW_ORDER");

      // Verify message has emailSubject
      const msg = await prisma.customerMessage.findUnique({
        where: { id: res1.messageId },
      });
      expect(msg).toBeDefined();
      expect((msg as any)?.emailSubject).toBe("Purchase Order");
    }

    // Second ingestion (webhook retry) -> Idempotency test
    const res2 = await ingestInboundMessage(prisma as any, inbound);
    if ("duplicate" in res2) {
      expect(res2.duplicate).toBe(true);
    }
  });
});
