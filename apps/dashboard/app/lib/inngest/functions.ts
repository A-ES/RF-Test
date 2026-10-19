import { processDocument } from "@/app/lib/documents/process";
import { generateInsightsForOrg } from "@/app/lib/insights/generate";
import { processCustomerAiReply } from "@/app/lib/messaging/ai-reply";
import {
  CUSTOMER_MESSAGE_AI_EVENT,
  DOCUMENT_PROCESS_EVENT,
  INSIGHT_GENERATE_EVENT,
  INTERNAL_MESSAGE_NOTIFY_EVENT,
  ORDER_CREATE_DRAFT_EVENT,
  ORDER_APPROVED_EVENT,
  inngest,
  type CustomerMessageAiEventData,
  type DocumentProcessEventData,
  type InsightGenerateEventData,
  type InternalMessageNotifyEventData,
  type OrderCreateDraftEventData,
  type OrderApprovedEventData,
} from "@/app/lib/inngest/client";

// ─── Document processing ──────────────────────────────────────────────────────

export const processDocumentFunction = inngest.createFunction(
  {
    id: "process-document",
    retries: 2,
    triggers: [{ event: DOCUMENT_PROCESS_EVENT }],
  },
  async ({ event, step }) => {
    const { documentId, organizationId } = event.data as DocumentProcessEventData;

    return step.run("extract-metadata", () =>
      processDocument(documentId, organizationId),
    );
  },
);

// ─── Insight generation — scheduled ──────────────────────────────────────────
//
// Runs once per day at 06:00 UTC for every organization that exists at that
// moment. Each org gets its own isolated step so one org's failure doesn't
// cancel others.

export const generateInsightsScheduled = inngest.createFunction(
  {
    id: "generate-insights-scheduled",
    retries: 1,
    triggers: [{ cron: "0 6 * * *" }],
  },
  async ({ step }: { step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    // Resolve all org IDs at the start of the run — this is the only query
    // that is intentionally un-scoped; we need every org.
    const orgs = await step.run("list-organizations", async () => {
      const { prisma } = await import("@/app/lib/db");
      return prisma.organization.findMany({ select: { id: true } });
    });

    // Fan out: one step per org so failures are isolated
    const results = await Promise.all(
      orgs.map((org: { id: string }) =>
        step.run(`generate-org-${org.id}`, () =>
          generateInsightsForOrg(org.id),
        ),
      ),
    );

    return { orgsProcessed: orgs.length, results };
  },
);

// ─── Insight generation — manual (event-triggered) ───────────────────────────
//
// Fired by POST /api/insights/analyze for a single org.
// The organizationId comes from the verified session — never from user input.

export const generateInsightsOnDemand = inngest.createFunction(
  {
    id: "generate-insights-on-demand",
    retries: 2,
    triggers: [{ event: INSIGHT_GENERATE_EVENT }],
  },
  async ({ event, step }) => {
    const { organizationId, triggeredBy } =
      event.data as InsightGenerateEventData;

    return step.run("generate", () => {
      console.log(
        `insights: on-demand run for org=${organizationId} trigger=${triggeredBy}`,
      );
      return generateInsightsForOrg(organizationId);
    });
  },
);

// ─── Customer inbound AI reply ────────────────────────────────────────────────
//
// Webhooks return as soon as the message is stored. Model inference happens
// here so Meta/email retries are not blocked on the LLM.

export const generateCustomerAiReply = inngest.createFunction(
  {
    id: "customer-message-ai-reply",
    retries: 2,
    triggers: [{ event: CUSTOMER_MESSAGE_AI_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as CustomerMessageAiEventData;

    return step.run("draft-reply", () => processCustomerAiReply(data));
  },
);

// ─── Internal Conversation Notification ────────────────────────────────────────

export const deliverInternalMessageNotificationFunction = inngest.createFunction(
  {
    id: "internal-message-notification",
    retries: 2,
    triggers: [{ event: INTERNAL_MESSAGE_NOTIFY_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as InternalMessageNotifyEventData;

    return step.run("deliver-notifications", async () => {
      const { prisma } = await import("@/app/lib/db");
      const { deliverNotifications } = await import("@/app/lib/notifications");

      const [priorSenders, sender, rfTeam] = await Promise.all([
        prisma.message.findMany({
          where: {
            conversationId: data.conversationId,
            organizationId: data.organizationId,
          },
          select: { senderId: true },
          distinct: ["senderId"],
        }),
        prisma.user.findFirst({
          where: { id: data.senderId, organizationId: data.organizationId },
          select: { id: true, isRFTeam: true },
        }),
        prisma.user.findMany({
          where: { organizationId: data.organizationId, isRFTeam: true },
          select: { id: true },
        }),
      ]);

      const isRF = sender?.isRFTeam ?? false;
      const recipientIds = new Set(priorSenders.map((row) => row.senderId));
      recipientIds.delete(data.senderId);
      if (!isRF) {
        for (const member of rfTeam) recipientIds.add(member.id);
      }

      if (recipientIds.size > 0) {
        await deliverNotifications({
          organizationId: data.organizationId,
          recipientIds: [...recipientIds],
          title: `New message in ${data.topic}`,
          body: data.content.length > 140 ? `${data.content.slice(0, 139)}…` : data.content,
          type: "INTERNAL_MESSAGE",
          linkHref: `/messages?id=${data.conversationId}`,
          category: "emailAlerts",
        });
      }

      return { deliveredCount: recipientIds.size };
    });
  },
);

// ─── WhatsApp Draft Order Creation ─────────────────────────────────────────────

export const createDraftOrder = inngest.createFunction(
  {
    id: "create-draft-order",
    retries: 2,
    triggers: [{ event: ORDER_CREATE_DRAFT_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as OrderCreateDraftEventData;

    return step.run("create-draft-order", async () => {
      const { processDraftOrder } = await import("@/app/lib/orders/draft");
      return processDraftOrder(data);
    });
  },
);

// ─── Post-Approval Orchestration (order.approved) ─────────────────────────────
//
// Driven by Inngest on order.approved (idempotent per orderId).
// Generates official gapless sequential invoice + server-side PDF + payment link,
// and sends initial customer notifications (ORDER_CONFIRMED, INVOICE_SENT).
export const handleOrderApproved = inngest.createFunction(
  {
    id: "handle-order-approved",
    retries: 2,
    triggers: [{ event: ORDER_APPROVED_EVENT }, { event: "order/approved" }],
  },
  async ({ event, step }) => {
    const data = event.data as OrderApprovedEventData;

    // Step 1: Generate sequential gapless Invoice + PDF + Payment link (strictly idempotent)
    const invoice = await step.run("generate-invoice", async () => {
      const { generateInvoiceForOrder } = await import("@/app/lib/invoices/service");
      return generateInvoiceForOrder({
        orderId: data.orderId,
        organizationId: data.organizationId,
      });
    });

    // Step 2: Send ORDER_CONFIRMED update to customer (idempotent dedupe)
    await step.run("send-order-confirmed", async () => {
      const { deliverCustomerUpdate } = await import("@/app/lib/messaging/customer-updates");
      return deliverCustomerUpdate({
        orderId: data.orderId,
        organizationId: data.organizationId,
        event: "ORDER_CONFIRMED",
      });
    });

    // Step 3: Send INVOICE_SENT update to customer (idempotent dedupe)
    await step.run("send-invoice-sent", async () => {
      const { deliverCustomerUpdate } = await import("@/app/lib/messaging/customer-updates");
      return deliverCustomerUpdate({
        orderId: data.orderId,
        organizationId: data.organizationId,
        event: "INVOICE_SENT",
        extraData: {
          invoiceNumber: invoice.invoiceNumber,
          paymentLink: invoice.paymentLinkUrl,
        },
      });
    });

    return {
      orderId: data.orderId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      completed: true,
    };
  },
);

