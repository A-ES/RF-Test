const fs = require('fs');

// Load environment variables
const envContent = fs.readFileSync('c:/Users/Sameer Walikar/Desktop/avi/apps/dashboard/.env', 'utf8');
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

const { PrismaClient } = require('c:/Users/Sameer Walikar/Desktop/avi/node_modules/@prisma/client');
const prisma = new PrismaClient();

// Crypto for HMAC signatures
const crypto = require('crypto');

async function runTests() {
  console.log("=================================================");
  console.log("   RF INTELLIGENCE COMMUNICATION HUB TESTS       ");
  console.log("=================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Get an existing organization or user
    const org = await prisma.organization.findFirst();
    assert(!!org, `Found organization: ${org?.name || 'none'} (${org?.id})`);

    // 2. Test MessagingInbox registration & Tenant Isolation
    const waPhoneId = "meta_test_phone_998877";
    const emailMailbox = "orders-test@acme-rf.com";

    const waInbox = await prisma.messagingInbox.upsert({
      where: {
        provider_externalAddress: {
          provider: "WHATSAPP",
          externalAddress: waPhoneId,
        },
      },
      update: { organizationId: org.id },
      create: {
        organizationId: org.id,
        provider: "WHATSAPP",
        externalAddress: waPhoneId,
        displayLabel: "Test WhatsApp Inbox",
      },
    });
    assert(waInbox.organizationId === org.id, "WhatsApp MessagingInbox registered with correct organization isolation");

    const emailInbox = await prisma.messagingInbox.upsert({
      where: {
        provider_externalAddress: {
          provider: "EMAIL",
          externalAddress: emailMailbox,
        },
      },
      update: { organizationId: org.id },
      create: {
        organizationId: org.id,
        provider: "EMAIL",
        externalAddress: emailMailbox,
        displayLabel: "Test Email Inbound Inbox",
      },
    });
    assert(emailInbox.organizationId === org.id, "Email MessagingInbox registered with correct organization isolation");

    // 3. Test Email Inbound Payload Parsing & Threading
    const { parseInboundEmailPayload, sanitizeEmailHtml, verifyEmailWebhookSignature } = await import('../apps/dashboard/app/lib/messaging/email.ts');

    const rawEmailPayload = JSON.stringify({
      from: "John Buyer <john.buyer@clientcorp.com>",
      to: [emailMailbox],
      subject: "New Purchase Order: Need 20 boxes Widget A and 10 boxes Widget B",
      text: "Hi Team,\n\nWe urgently need 20 boxes of Widget A and 10 boxes of Widget B delivered tomorrow.\n\nPlease send invoice.\n\nThanks,\nJohn",
      messageId: "<msg-test-po-12345@clientcorp.com>",
      headers: {
        "message-id": "<msg-test-po-12345@clientcorp.com>",
      },
    });

    const parsedInboundEmails = parseInboundEmailPayload(rawEmailPayload);
    assert(parsedInboundEmails.length === 1, "Parsed inbound email payload successfully");
    assert(parsedInboundEmails[0].contactIdentifier === "john.buyer@clientcorp.com", "Contact identifier extracted as lowercased email");
    assert(parsedInboundEmails[0].inboxIdentifier === emailMailbox, "Inbox identifier matched destination mailbox");
    assert(parsedInboundEmails[0].providerMessageId === "<msg-test-po-12345@clientcorp.com>", "Message-ID preserved for thread continuity");

    // 4. Test Email Webhook Signature Verification
    const secret = "test-secret-key-123";
    const sig = crypto.createHmac("sha256", secret).update(rawEmailPayload).digest("hex");
    assert(verifyEmailWebhookSignature(rawEmailPayload, sig, secret), "HMAC signature verified successfully");
    assert(!verifyEmailWebhookSignature(rawEmailPayload, "invalid_sig", secret), "Invalid HMAC signature rejected");

    // 5. Test AI 11-Category Classification
    const { classifyMessageHeuristic, analyzeIncomingMessage } = await import('../apps/dashboard/app/lib/messaging/ai-classification.ts');

    // Test NEW_ORDER
    const orderAi = await analyzeIncomingMessage("Hi, I need 20 boxes of product A and 10 boxes of product B. Can you deliver them tomorrow?");
    assert(orderAi.intent === "NEW_ORDER", `Order intent detected correctly: ${orderAi.intent}`);
    assert(orderAi.requestedQuantities.length >= 2, `Quantities extracted: ${JSON.stringify(orderAi.requestedQuantities)}`);
    assert(orderAi.urgency === "HIGH" || orderAi.urgency === "MEDIUM", `Urgency detected: ${orderAi.urgency}`);

    // Test COMPLAINT
    const complaintAi = await analyzeIncomingMessage("I am extremely disappointed. Order #ORD-4492 arrived with damaged and broken boxes. This is unacceptable!");
    assert(complaintAi.intent === "COMPLAINT", `Complaint intent detected correctly: ${complaintAi.intent}`);
    assert(complaintAi.customerSentiment === "FRUSTRATED", `Customer sentiment detected: ${complaintAi.customerSentiment}`);
    assert(complaintAi.relatedOrderReference !== null, `Related order reference detected: ${complaintAi.relatedOrderReference}`);

    // Test DELIVERY_ENQUIRY
    const deliveryAi = await analyzeIncomingMessage("Where is my shipment for #ORD-102? Can you share the tracking number?");
    assert(deliveryAi.intent === "DELIVERY_ENQUIRY", `Delivery inquiry detected: ${deliveryAi.intent}`);

    // Test PRODUCT_ENQUIRY
    const productAi = await analyzeIncomingMessage("Could you share the catalog and prices for industrial switches?");
    assert(productAi.intent === "PRODUCT_ENQUIRY", `Product inquiry detected: ${productAi.intent}`);

    // 6. Test HTML Sanitization (No XSS)
    const dangerousHtml = "<script>alert('xss')</script><p onmouseover='steal()'>Hello <b>World</b></p><iframe src='evil.com'></iframe>";
    const cleaned = sanitizeEmailHtml(dangerousHtml);
    assert(!cleaned.includes("<script>"), "Scripts stripped from email HTML");
    assert(!cleaned.includes("onmouseover"), "Inline event handlers stripped from email HTML");
    assert(!cleaned.includes("<iframe>"), "iFrames stripped from email HTML");

    // 7. Test Customer & Conversation Ingestion
    const { ingestInboundMessage } = await import('../apps/dashboard/app/lib/messaging/ingest.ts');

    const ingestResult = await ingestInboundMessage(prisma, parsedInboundEmails[0]);
    assert(ingestResult && !ingestResult.skipped, "Inbound email ingested into DB");
    assert(ingestResult.organizationId === org.id, "Ingested conversation belongs to verified organization");

    // Test Idempotency (duplicate message with same providerMessageId)
    const duplicateResult = await ingestInboundMessage(prisma, parsedInboundEmails[0]);
    assert(duplicateResult && duplicateResult.duplicate === true, "Duplicate webhook identified and deduplicated without re-creating message");

    // 8. Test Clean Up Test Records
    await prisma.customerMessage.deleteMany({
      where: { providerMessageId: "<msg-test-po-12345@clientcorp.com>" },
    });
    await prisma.messagingInbox.deleteMany({
      where: { externalAddress: { in: [waPhoneId, emailMailbox] } },
    });

    console.log("=================================================");
    console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
    console.log("=================================================");
  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
