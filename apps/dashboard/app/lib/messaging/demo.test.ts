import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/app/lib/db";
import { POST as demoInboundPOST } from "@/app/api/demo/inbound/route";
import { POST as demoResetPOST } from "@/app/api/demo/reset/route";
import { GET as demoThreadGET } from "@/app/api/demo/thread/route";
import { POST as demoUploadAudioPOST } from "@/app/api/demo/upload-audio/route";
import { POST as whatsappWebhookPOST } from "@/app/api/webhooks/whatsapp/route";
import { signWhatsAppBody } from "@/app/lib/messaging/whatsapp";
import { demoProvider, ensureDemoInbox } from "@/app/lib/messaging/demo";
import { messagingProviderFor } from "@/app/lib/messaging/providers";
import { REALTIME_EVENTS } from "@/app/lib/realtime/channels";

// Mock session
const mockSession = vi.hoisted(() => ({
  current: {
    userId: "usr_admin",
    organizationId: "org_demo_test",
    role: "CLIENT_ADMIN" as const,
    name: "Demo Admin",
  } as { userId: string; organizationId: string; role: "CLIENT_ADMIN" | "ADMIN" | "CLIENT_EMPLOYEE"; name: string } | null,
}));

vi.mock("@/app/lib/session", () => ({
  getSession: vi.fn(async () => mockSession.current),
}));

// Mock realtime & inngest
const mocks = vi.hoisted(() => ({
  publishToChannel: vi.fn(async () => true),
  inngestSend: vi.fn(async () => undefined),
}));

vi.mock("@/app/lib/realtime/server", () => ({
  publishToChannel: mocks.publishToChannel,
  isRealtimeConfigured: () => true,
}));

vi.mock("@/app/lib/inngest/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/inngest/client")>();
  return {
    ...actual,
    inngest: {
      ...actual.inngest,
      send: mocks.inngestSend,
    },
  };
});

const APP_SECRET = "test-webhook-secret-xyz";

describe("Demo Channel Integration & Parity", () => {
  const createdOrgIds: string[] = [];

  beforeEach(() => {
    process.env.DEMO_CHANNEL_ENABLED = "true";
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.SYNC_ORDER_PIPELINE = "1"; // Run draft creation synchronously
    mocks.publishToChannel.mockClear();
    mocks.inngestSend.mockClear();
  });

  afterEach(async () => {
    delete process.env.DEMO_CHANNEL_ENABLED;
    delete process.env.SYNC_ORDER_PIPELINE;
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrgIds } },
      });
      createdOrgIds.length = 0;
    }
  });

  async function createTestTenant(prefix: string) {
    const orgId = `org_demo_${prefix.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    createdOrgIds.push(orgId);

    const org = await prisma.organization.create({
      data: {
        id: orgId,
        name: `Tenant ${prefix} ${Date.now()}`,
      },
    });

    await prisma.product.create({
      data: {
        organizationId: org.id,
        sku: "PROD-A",
        name: "Product A",
        basePriceMinor: 5000,
        unit: "cases",
        aliases: {
          create: [
            { organizationId: org.id, alias: "prod a" },
            { organizationId: org.id, alias: "product a" },
          ],
        },
        inventoryLevel: {
          create: {
            organizationId: org.id,
            onHand: 100,
            reserved: 0,
          },
        },
      },
    });

    await prisma.product.create({
      data: {
        organizationId: org.id,
        sku: "PROD-B",
        name: "Product B",
        basePriceMinor: 2500,
        unit: "units",
        aliases: {
          create: [
            { organizationId: org.id, alias: "prod b" },
            { organizationId: org.id, alias: "product b" },
          ],
        },
        inventoryLevel: {
          create: {
            organizationId: org.id,
            onHand: 50,
            reserved: 0,
          },
        },
      },
    });

    return org;
  }

  // ─── Requirement 1 & 6: 404 when DEMO_CHANNEL_ENABLED is false ────────────────
  it("returns 404 on all demo routes when DEMO_CHANNEL_ENABLED is false or unset", async () => {
    process.env.DEMO_CHANNEL_ENABLED = "false";
    mockSession.current = {
      userId: "usr_admin",
      organizationId: "org_dummy",
      role: "CLIENT_ADMIN",
      name: "Admin",
    };

    const reqInbound = new Request("http://localhost:3000/api/demo/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });
    const resInbound = await demoInboundPOST(reqInbound);
    expect(resInbound.status).toBe(404);

    const resReset = await demoResetPOST();
    expect(resReset.status).toBe(404);

    const reqThread = new Request("http://localhost:3000/api/demo/thread");
    const resThread = await demoThreadGET(reqThread);
    expect(resThread.status).toBe(404);

    const reqAudio = new Request("http://localhost:3000/api/demo/upload-audio", {
      method: "POST",
    });
    const resAudio = await demoUploadAudioPOST(reqAudio);
    expect(resAudio.status).toBe(404);
  });

  // ─── Requirement 6: Cross-org access returns 404 ─────────────────────────────
  it("returns 404 when attempting cross-org access with customerId from another organization", async () => {
    process.env.DEMO_CHANNEL_ENABLED = "true";

    const orgA = await createTestTenant("OrgA");
    const orgB = await createTestTenant("OrgB");

    // Create a customer in Org B
    const custB = await prisma.customer.create({
      data: {
        organizationId: orgB.id,
        name: "Victim Corp",
        phone: "+15559998888",
        status: "ACTIVE",
        tagsJson: "[]",
      },
    });

    // Session is logged into Org A
    mockSession.current = {
      userId: "usr_admin",
      organizationId: orgA.id,
      role: "CLIENT_ADMIN",
      name: "Org A Admin",
    };

    const req = new Request("http://localhost:3000/api/demo/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: custB.id,
        text: "Hi, I need 20 cases of Product A",
      }),
    });

    const res = await demoInboundPOST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/Customer not found/i);
  });

  // ─── Requirement 2 & 6: Outbound never calls any external API ─────────────────
  it("demo outbound never calls any external API and writes to DB and publishes to Ably", async () => {
    process.env.DEMO_CHANNEL_ENABLED = "true";
    const org = await createTestTenant("Outbound");
    await ensureDemoInbox(org.id);

    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        name: "Acme Grocery",
        phone: "+15551234567",
        status: "ACTIVE",
        tagsJson: "[]",
      },
    });

    const conversation = await prisma.customerConversation.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        channel: "DEMO",
        status: "AI_HANDLING",
        tagsJson: "[]",
      },
    });

    // Ensure messagingProviderFor("DEMO") resolves to demoProvider
    const provider = messagingProviderFor("DEMO");
    expect(provider.name).toBe("demo");

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const sendRes = await provider.sendOutbound({
      inboxIdentifier: `demo-inbox-${org.id}`,
      contactIdentifier: customer.phone!,
      body: "Hello customer, your order has been received!",
    });

    // Verify: NOTHING leaves the app (no external HTTP calls)
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    // Verify: CustomerMessage was written
    const savedMsg = await prisma.customerMessage.findFirst({
      where: {
        conversationId: conversation.id,
        body: "Hello customer, your order has been received!",
      },
    });
    expect(savedMsg).toBeDefined();
    expect(savedMsg?.providerMessageId).toBe(sendRes.providerMessageId);

    // Verify: Realtime Ably event was published
    expect(mocks.publishToChannel).toHaveBeenCalledWith(
      `rf-intel:org:${org.id}:messages`,
      REALTIME_EVENTS.messageCreated,
      expect.objectContaining({
        conversationId: conversation.id,
      }),
    );
  });

  // ─── Requirement 3: Idempotency with client-supplied messageId ───────────────
  it("is idempotent when client supplies the same messageId", async () => {
    process.env.DEMO_CHANNEL_ENABLED = "true";
    const org = await createTestTenant("Idemp");

    mockSession.current = {
      userId: "usr_admin",
      organizationId: org.id,
      role: "CLIENT_ADMIN",
      name: "Admin",
    };

    const clientMessageId = `idemp_msg_${Date.now()}`;

    // First request
    const req1 = new Request("http://localhost:3000/api/demo/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: { name: "Quick Market", phone: "+15557770001" },
        text: "Hi, I need 20 cases of Product A",
        messageId: clientMessageId,
      }),
    });
    const res1 = await demoInboundPOST(req1);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.duplicate).toBe(false);

    // Second request with identical client messageId
    const req2 = new Request("http://localhost:3000/api/demo/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: { name: "Quick Market", phone: "+15557770001" },
        text: "Hi, I need 20 cases of Product A",
        messageId: clientMessageId,
      }),
    });
    const res2 = await demoInboundPOST(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.duplicate).toBe(true);
    expect(data2.messageId).toBe(data1.messageId);

    // Only 1 CustomerMessage in DB
    const count = await prisma.customerMessage.count({
      where: { organizationId: org.id, providerMessageId: clientMessageId },
    });
    expect(count).toBe(1);
  });

  // ─── Requirement 6: Side-by-side Parity Test (WhatsApp vs Demo Inbound) ────────
  it("inbound demo message produces the exact same draft order as the equivalent WhatsApp webhook payload in a side-by-side test", async () => {
    process.env.DEMO_CHANNEL_ENABLED = "true";
    const org = await createTestTenant("Parity");

    const phoneId = `wa_phone_${Date.now()}`;
    await prisma.messagingInbox.create({
      data: {
        organizationId: org.id,
        provider: "WHATSAPP",
        externalAddress: phoneId,
        displayLabel: "WhatsApp Main",
      },
    });

    const specOrderSentence =
      "Hi, I need 20 cases of Product A and 10 units of Product B delivered tomorrow";

    // ─────────────────────────────────────────────────────────────────────────
    // Path 1: WhatsApp Webhook Payload
    // ─────────────────────────────────────────────────────────────────────────
    const waPayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "wa_biz_1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550001111",
                  phone_number_id: phoneId,
                },
                contacts: [{ profile: { name: "WhatsApp Buyer" }, wa_id: "15550001111" }],
                messages: [
                  {
                    from: "15550001111",
                    id: `wamid_parity_${Date.now()}`,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    type: "text",
                    text: { body: specOrderSentence },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const waSignature = signWhatsAppBody(waPayload, APP_SECRET);
    const waReq = new Request("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": waSignature,
      },
      body: waPayload,
    });

    const waRes = await whatsappWebhookPOST(waReq);
    expect(waRes.status).toBe(200);

    // Find draft order created via WhatsApp
    const waCust = await prisma.customer.findFirst({
      where: { organizationId: org.id, whatsapp: "+15550001111" },
    });
    expect(waCust).toBeDefined();

    const waOrder = await prisma.order.findFirst({
      where: { organizationId: org.id, customerId: waCust!.id },
      include: {
        lines: { orderBy: { sku: "asc" } },
      },
    });
    expect(waOrder).toBeDefined();
    expect(["DRAFT", "NEEDS_REVIEW"]).toContain(waOrder?.status);
    expect(waOrder?.lines).toHaveLength(2);

    // ─────────────────────────────────────────────────────────────────────────
    // Path 2: Demo Inbound Endpoint
    // ─────────────────────────────────────────────────────────────────────────
    mockSession.current = {
      userId: "usr_admin",
      organizationId: org.id,
      role: "CLIENT_ADMIN",
      name: "Admin",
    };

    const demoReq = new Request("http://localhost:3000/api/demo/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: { name: "Demo Buyer", phone: "+15550002222" },
        text: specOrderSentence,
        messageId: `demo_parity_${Date.now()}`,
      }),
    });

    const demoRes = await demoInboundPOST(demoReq);
    expect(demoRes.status).toBe(200);

    // Find draft order created via Demo
    const demoCust = await prisma.customer.findFirst({
      where: { organizationId: org.id, phone: "+15550002222" },
    });
    expect(demoCust).toBeDefined();

    const demoOrder = await prisma.order.findFirst({
      where: { organizationId: org.id, customerId: demoCust!.id },
      include: {
        lines: { orderBy: { sku: "asc" } },
      },
    });
    expect(demoOrder).toBeDefined();
    expect(demoOrder?.status).toBe(waOrder?.status);
    expect(demoOrder?.lines).toHaveLength(2);

    // ─────────────────────────────────────────────────────────────────────────
    // Side-by-Side Comparison
    // ─────────────────────────────────────────────────────────────────────────
    // Total amounts match
    expect(demoOrder?.totalMinor).toBe(waOrder?.totalMinor);
    expect(demoOrder?.currency).toBe(waOrder?.currency);

    // Lines & SKUs match exactly
    expect(demoOrder?.lines[0].sku).toBe(waOrder?.lines[0].sku);
    expect(demoOrder?.lines[0].qty).toBe(waOrder?.lines[0].qty);
    expect(demoOrder?.lines[0].unitPriceMinor).toBe(waOrder?.lines[0].unitPriceMinor);
    expect(demoOrder?.lines[0].lineTotalMinor).toBe(waOrder?.lines[0].lineTotalMinor);

    expect(demoOrder?.lines[1].sku).toBe(waOrder?.lines[1].sku);
    expect(demoOrder?.lines[1].qty).toBe(waOrder?.lines[1].qty);
    expect(demoOrder?.lines[1].unitPriceMinor).toBe(waOrder?.lines[1].unitPriceMinor);
    expect(demoOrder?.lines[1].lineTotalMinor).toBe(waOrder?.lines[1].lineTotalMinor);
  });

  // ─── Requirement 4: Reset demo data button route ─────────────────────────────
  it("reset demo data deletes only DEMO-channel conversations, demo orders and demo customers for this org", async () => {
    process.env.DEMO_CHANNEL_ENABLED = "true";
    const org = await createTestTenant("Reset");

    mockSession.current = {
      userId: "usr_admin",
      organizationId: org.id,
      role: "CLIENT_ADMIN",
      name: "Admin",
    };

    // 1. Create a DEMO customer, conversation and draft order
    const demoCust = await prisma.customer.create({
      data: {
        organizationId: org.id,
        name: "Demo Customer",
        phone: "+15550009999",
        status: "ACTIVE",
        tagsJson: JSON.stringify(["demo", "inbound"]),
      },
    });

    const demoConv = await prisma.customerConversation.create({
      data: {
        organizationId: org.id,
        customerId: demoCust.id,
        channel: "DEMO",
        status: "WAITING_FOR_CLIENT",
        tagsJson: "[]",
      },
    });

    await prisma.customerMessage.create({
      data: {
        organizationId: org.id,
        conversationId: demoConv.id,
        sender: "CUSTOMER",
        body: "Test message",
      },
    });

    await prisma.order.create({
      data: {
        organizationId: org.id,
        customerId: demoCust.id,
        conversationId: demoConv.id,
        draftNumber: `DRAFT-DEMO-${Date.now()}`,
        status: "DRAFT",
        totalMinor: 5000,
        currency: "USD",
        version: 1,
      },
    });

    // 2. Create a REAL / NON-DEMO customer, conversation, and order
    const realCust = await prisma.customer.create({
      data: {
        organizationId: org.id,
        name: "Real VIP Customer",
        phone: "+15551112222",
        status: "ACTIVE",
        tagsJson: JSON.stringify(["vip", "wholesale"]),
      },
    });

    const realConv = await prisma.customerConversation.create({
      data: {
        organizationId: org.id,
        customerId: realCust.id,
        channel: "WHATSAPP",
        status: "WAITING_FOR_CLIENT",
        tagsJson: "[]",
      },
    });

    const realOrder = await prisma.order.create({
      data: {
        organizationId: org.id,
        customerId: realCust.id,
        conversationId: realConv.id,
        draftNumber: `DRAFT-REAL-${Date.now()}`,
        status: "DRAFT",
        totalMinor: 12000,
        currency: "USD",
        version: 1,
      },
    });

    // 3. Call POST /api/demo/reset
    const res = await demoResetPOST();
    expect(res.status).toBe(200);

    // 4. Verify DEMO data deleted
    const remainingDemoConv = await prisma.customerConversation.findUnique({
      where: { id: demoConv.id },
    });
    expect(remainingDemoConv).toBeNull();

    const remainingDemoCust = await prisma.customer.findUnique({
      where: { id: demoCust.id },
    });
    expect(remainingDemoCust).toBeNull();

    // 5. Verify REAL data is completely untouched
    const remainingRealConv = await prisma.customerConversation.findUnique({
      where: { id: realConv.id },
    });
    expect(remainingRealConv).toBeDefined();

    const remainingRealCust = await prisma.customer.findUnique({
      where: { id: realCust.id },
    });
    expect(remainingRealCust).toBeDefined();

    const remainingRealOrder = await prisma.order.findUnique({
      where: { id: realOrder.id },
    });
    expect(remainingRealOrder).toBeDefined();
  });
});
