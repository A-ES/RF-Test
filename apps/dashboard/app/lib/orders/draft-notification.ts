import { prisma } from "@/app/lib/db";
import { deliverNotifications } from "@/app/lib/notifications";

export interface NotifyDraftReadyInput {
  organizationId: string;
  orderId: string;
  draftNumber: string;
  customerName?: string | null;
  totalMinor?: number | null;
}

export interface NotifyDraftReadyResult {
  notified: boolean;
  dedupeSkipped: boolean;
  recipientCount: number;
}

/**
 * Delivers preference-aware client notifications when a new order draft is ready
 * for administrative review and confirmation.
 *
 * Requirements:
 * - In-app notification (stored in Notification table + broadcast via Ably)
 * - Email notification (via email abstraction / Resend)
 * - Deduplicated via NotificationLog using a deterministic dedupeKey
 * - Links directly to /orders/:id
 */
export async function notifyClientDraftReady(
  input: NotifyDraftReadyInput,
): Promise<NotifyDraftReadyResult> {
  const dedupeKey = `org:${input.organizationId}:order:${input.orderId}:draft_ready`;

  // 1. Check for existing notification log entry
  const existingLog = await prisma.notificationLog.findUnique({
    where: { dedupeKey },
  });

  if (existingLog) {
    return {
      notified: false,
      dedupeSkipped: true,
      recipientCount: 0,
    };
  }

  // 2. Resolve client administrators who can review and approve orders
  const admins = await prisma.user.findMany({
    where: {
      organizationId: input.organizationId,
      role: { in: ["CLIENT_ADMIN", "ADMIN"] },
    },
    select: { id: true, email: true },
  });

  const recipientIds = admins.map((u) => u.id);
  if (recipientIds.length === 0) {
    // If no explicit admins found, fall back to any active member in the org
    const anyUsers = await prisma.user.findMany({
      where: {
        organizationId: input.organizationId,
      },
      take: 5,
      select: { id: true },
    });
    recipientIds.push(...anyUsers.map((u) => u.id));
  }

  const customerLabel = input.customerName?.trim() || "Customer";
  const amountStr =
    typeof input.totalMinor === "number"
      ? ` (₹${(input.totalMinor / 100).toFixed(2)})`
      : "";
  const title = `Draft Order ${input.draftNumber} Ready for Review`;
  const body = `New order request ${input.draftNumber} from ${customerLabel}${amountStr} is waiting for client approval.`;
  const linkHref = `/orders/${input.orderId}`;

  // 3. Deliver notifications across in-app (Ably) and email
  if (recipientIds.length > 0) {
    await deliverNotifications({
      organizationId: input.organizationId,
      recipientIds,
      title,
      body,
      linkHref,
      type: "GENERAL",
      category: "emailAlerts",
      metadataJson: JSON.stringify({
        orderId: input.orderId,
        draftNumber: input.draftNumber,
      }),
    });
  }

  // 4. Record deduplicated NotificationLog row
  try {
    await prisma.notificationLog.create({
      data: {
        organizationId: input.organizationId,
        orderId: input.orderId,
        audience: "CLIENT",
        channel: "IN_APP_AND_EMAIL",
        template: "DRAFT_READY",
        dedupeKey,
        status: "SENT",
      },
    });
  } catch (err) {
    // If concurrent insert occurred, treat as deduped
    return {
      notified: true,
      dedupeSkipped: true,
      recipientCount: recipientIds.length,
    };
  }

  return {
    notified: true,
    dedupeSkipped: false,
    recipientCount: recipientIds.length,
  };
}
