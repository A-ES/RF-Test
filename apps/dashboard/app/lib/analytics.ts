/**
 * Analytics Event Tracking Surface
 *
 * Tracks core user actions across the platform:
 *  - insight_viewed
 *  - insight_accepted
 *  - insight_dismissed
 *  - ask_rf_query_asked
 *  - customer_conversation_escalated
 *  - customer_conversation_resolved
 *  - document_uploaded
 */

export type AnalyticsEventType =
  | "insight_viewed"
  | "insight_accepted"
  | "insight_dismissed"
  | "ask_rf_query_asked"
  | "customer_conversation_escalated"
  | "customer_conversation_resolved"
  | "document_uploaded";

export interface AnalyticsEvent {
  event: AnalyticsEventType;
  organizationId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export function trackEvent(
  event: AnalyticsEventType,
  metadata?: Record<string, unknown>,
  context?: { organizationId?: string; userId?: string },
): void {
  const payload: AnalyticsEvent = {
    event,
    organizationId: context?.organizationId,
    userId: context?.userId,
    metadata: metadata ?? {},
    timestamp: new Date().toISOString(),
  };

  if (typeof window !== "undefined") {
    // Client-side event dispatch
    console.log(`[ANALYTICS] ${event}`, payload);
    try {
      window.dispatchEvent(
        new CustomEvent("rf_analytics_event", { detail: payload }),
      );
    } catch {
      // Ignore in non-browser environments
    }
  } else {
    // Server-side event logging
    console.log(`[SERVER ANALYTICS] ${event}`, payload);
  }
}
