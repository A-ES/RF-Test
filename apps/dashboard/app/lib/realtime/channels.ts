/**
 * Realtime channel naming + parsing.
 *
 * Every channel is scoped to exactly one organization so that a subscriber can
 * only ever be authorized for the tenant they belong to:
 *
 *   rf-intel:org:<organizationId>:<scope>
 *
 * `parseOrganizationFromChannel` is the single source of truth used by the
 * channel authorization endpoint to decide whether a session may subscribe.
 */

export const REALTIME_CHANNEL_PREFIX = "rf-intel";

export type RealtimeScope = "messages" | "notifications" | "orders";

export const REALTIME_EVENTS = {
  messageCreated: "message:new",
  conversationCreated: "conversation:new",
  notificationCreated: "notification:new",
  orderCreated: "order:new",
  orderUpdated: "order:updated",
} as const;

export function orgChannel(
  organizationId: string,
  scope: RealtimeScope = "messages",
): string {
  return `${REALTIME_CHANNEL_PREFIX}:org:${organizationId}:${scope}`;
}

export function parseOrganizationFromChannel(channel: string): string | null {
  const match = new RegExp(
    `^${REALTIME_CHANNEL_PREFIX}:org:([^:]+):[^:]+$`,
  ).exec(channel);
  return match?.[1] ?? null;
}
