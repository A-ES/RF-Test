export const REALTIME_CHANNEL_PREFIX = "rf-intel";

export type RealtimeScope = "messages" | "notifications";

export const REALTIME_EVENTS = {
  messageCreated: "message:new",
  conversationCreated: "conversation:new",
  conversationUpdated: "conversation:updated",
  notificationCreated: "notification:new",
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
