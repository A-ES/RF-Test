import { prisma } from "@/app/lib/db";
import { sendEmail } from "@/app/lib/email";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";

/**
 * Preference-aware notification delivery across all system events.
 *
 * In-app notifications are written to the `Notification` model in a single
 * batched insert, published in real-time over Ably to org recipients, and
 * emails are dispatched when the recipient's `NotificationPreference` allows
 * the relevant category.
 */

export type NotificationCategory =
  | "emailAlerts"
  | "riskSignals"
  | "weeklyDigest";

export type NotificationType =
  | "NEW_CUSTOMER_MESSAGE"
  | "AI_RESPONSE_SENT"
  | "HUMAN_ESCALATION"
  | "NEW_CUSTOMER"
  | "HIGH_PRIORITY_ISSUE"
  | "FAILED_JOB"
  | "INTERNAL_MESSAGE"
  | "INSIGHT_ALERT"
  | "REPORT_READY"
  | "GENERAL";

export interface DeliverNotificationInput {
  organizationId: string;
  recipientIds: string[];
  title: string;
  body: string;
  type?: NotificationType;
  category?: NotificationCategory;
  linkHref?: string;
  metadataJson?: string;
}

export interface DeliveredNotification {
  userId: string;
  emailed: boolean;
}

interface PreferenceRow {
  userId: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  emailAlerts: boolean;
  riskSignals: boolean;
  weeklyDigest: boolean;
}

function categoryAllowsEmail(
  pref: PreferenceRow,
  category: NotificationCategory,
): boolean {
  if (!pref.emailEnabled) return false;
  return pref[category] === true;
}

export async function deliverNotifications(
  input: DeliverNotificationInput,
): Promise<DeliveredNotification[]> {
  const recipients = [...new Set(input.recipientIds)].filter(Boolean);
  if (recipients.length === 0) return [];

  const category = input.category ?? "emailAlerts";
  const type = input.type ?? "GENERAL";

  const [preferences, users] = await Promise.all([
    prisma.notificationPreference.findMany({
      where: { userId: { in: recipients }, organizationId: input.organizationId },
    }),
    prisma.user.findMany({
      where: { id: { in: recipients }, organizationId: input.organizationId },
      select: { id: true, email: true },
    }),
  ]);

  const prefByUser = new Map(
    preferences.map((pref: PreferenceRow) => [pref.userId, pref]),
  );

  const inAppRows: Array<{
    organizationId: string;
    userId: string;
    title: string;
    body: string;
    type: string;
    linkHref?: string | null;
    metadataJson?: string | null;
  }> = [];
  const emailTargets: Array<{ id: string; email: string }> = [];

  for (const user of users) {
    const pref = prefByUser.get(user.id);

    if (!pref || pref.inAppEnabled) {
      inAppRows.push({
        organizationId: input.organizationId,
        userId: user.id,
        title: input.title,
        body: input.body,
        type,
        linkHref: input.linkHref ?? null,
        metadataJson: input.metadataJson ?? null,
      });
    }

    if (!pref || categoryAllowsEmail(pref, category)) {
      emailTargets.push(user);
    }
  }

  if (inAppRows.length > 0) {
    await prisma.notification.createMany({ data: inAppRows });

    // Real-time broadcast for immediate badge update and toast alert
    await publishToChannel(
      orgChannel(input.organizationId, "notifications"),
      REALTIME_EVENTS.notificationCreated,
      {
        organizationId: input.organizationId,
        recipientIds: inAppRows.map((r) => r.userId),
        title: input.title,
        body: input.body,
        type,
        linkHref: input.linkHref ?? null,
        createdAt: new Date().toISOString(),
      },
    );
  }

  const emailed = await Promise.all(
    emailTargets.map(async (user) => {
      const result = await sendEmail({
        to: user.email,
        subject: input.title,
        body: input.body,
      });
      return { userId: user.id, emailed: result.delivered };
    }),
  );

  const emailedByUser = new Map(emailed.map((entry) => [entry.userId, entry.emailed]));
  return users.map((user) => ({
    userId: user.id,
    emailed: emailedByUser.get(user.id) ?? false,
  }));
}
