import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "rf-intelligence" });

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
