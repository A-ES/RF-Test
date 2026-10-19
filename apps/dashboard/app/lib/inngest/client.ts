import { Inngest } from "inngest";

const isDev =
  process.env.NODE_ENV !== "production" || process.env.INNGEST_DEV === "1";

const inngestBaseUrl =
  process.env.INNGEST_BASE_URL ||
  (isDev ? "http://127.0.0.1:8288" : undefined);

export const inngest = new Inngest({
  id: "rf-intelligence",
  baseUrl: inngestBaseUrl,
  isDev,
});

// ─── Document processing ──────────────────────────────────────────────────────

export const DOCUMENT_PROCESS_EVENT = "document/process.requested";

export interface DocumentProcessEventData {
  documentId: string;
  organizationId: string;
}

// ─── Insight generation ───────────────────────────────────────────────────────

/** Fired by the manual "Analyze now" API endpoint */
export const INSIGHT_GENERATE_EVENT = "insight/generate.requested";

export interface InsightGenerateEventData {
  /** The org to analyse. Always set server-side from the verified session. */
  organizationId: string;
  /** Human-readable trigger reason, stored in logs only */
  triggeredBy: "schedule" | "manual";
}

// ─── Customer inbound AI reply ────────────────────────────────────────────────

/** Fired by the messaging webhook after a customer message is persisted. */
export const CUSTOMER_MESSAGE_AI_EVENT = "customer-message/ai-response.requested";

export interface CustomerMessageAiEventData {
  organizationId: string;
  customerId: string;
  conversationId: string;
  messageId: string;
}

// ─── Internal Conversation Notification ────────────────────────────────────────

/** Fired after an internal team/client message is persisted to dispatch notifications in background */
export const INTERNAL_MESSAGE_NOTIFY_EVENT = "internal-message/notify.requested";

export interface InternalMessageNotifyEventData {
  organizationId: string;
  conversationId: string;
  senderId: string;
  messageId: string;
  content: string;
  topic: string;
}

// ─── Order draft creation ──────────────────────────────────────────────────────

/** Fired when an inbound customer message has order intent (ORDER_REQUEST or ORDER_CHANGE). */
export const ORDER_CREATE_DRAFT_EVENT = "order/create-draft.requested";

export interface OrderCreateDraftEventData {
  organizationId: string;
  customerId: string;
  conversationId: string;
  messageId: string;
  intent?: "ORDER_REQUEST" | "ORDER_CHANGE";
  isNewCustomer?: boolean;
}

// ─── Order Approved Post-Approval Workflow ────────────────────────────────────

/** Fired when an order is approved by an administrator to trigger post-approval tasks. */
export const ORDER_APPROVED_EVENT = "order.approved";

export interface OrderApprovedEventData {
  orderId: string;
  organizationId: string;
  orderNumber?: string;
}


