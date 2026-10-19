import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export interface UnifiedTimelineEntry {
  id: string;
  source: "ORDER_EVENT" | "NOTIFICATION_LOG" | "PAYMENT";
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  title: string;
  description?: string;
  beforeValue?: string | null;
  afterValue?: string | null;
  statusBadge?: string;
  payload?: Record<string, unknown>;
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/orders/[id]/timeline">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  const order = await prisma.order.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, orderNumber: true, draftNumber: true },
  });

  if (!order) return json({ error: "Order not found" }, 404);

  // 1. Fetch OrderEvents
  const events = await prisma.orderEvent.findMany({
    where: { orderId: id, organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
  });

  const actorIds = events.map((e) => e.actorId).filter((aid): aid is string => Boolean(aid));
  const users = actorIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, role: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 2. Fetch NotificationLogs
  const notifications = await prisma.notificationLog.findMany({
    where: { orderId: id, organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
  });

  // 3. Fetch Payments
  const payments = await prisma.payment.findMany({
    where: { orderId: id, organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
  });

  const timeline: UnifiedTimelineEntry[] = [];

  // Map OrderEvents
  for (const ev of events) {
    let payload: Record<string, unknown> = {};
    try {
      if (ev.payloadJson) payload = JSON.parse(ev.payloadJson);
    } catch {}

    const user = ev.actorId ? userMap.get(ev.actorId) : null;
    const actorName = user?.name || (ev.actorKind === "SYSTEM" ? "Automated System" : ev.actorKind);
    const actorRole = user?.role || ev.actorKind;

    timeline.push({
      id: `ev_${ev.id}`,
      source: "ORDER_EVENT",
      timestamp: ev.createdAt.toISOString(),
      actorName,
      actorRole,
      action: ev.type,
      title: formatEventTitle(ev.type),
      description: payload.reason ? String(payload.reason) : undefined,
      beforeValue: ev.fromStatus ?? null,
      afterValue: ev.toStatus ?? null,
      statusBadge: ev.toStatus || ev.type,
      payload,
    });
  }

  // Map NotificationLogs
  for (const notif of notifications) {
    const payload: Record<string, unknown> = {
      template: notif.template,
      dedupeKey: notif.dedupeKey,
      providerMessageId: notif.providerMessageId,
      error: notif.error,
    };

    timeline.push({
      id: `notif_${notif.id}`,
      source: "NOTIFICATION_LOG",
      timestamp: notif.createdAt.toISOString(),
      actorName: `${notif.channel || "WhatsApp"} Gateway`,
      actorRole: "NOTIFICATION",
      action: notif.template || "NOTIFICATION",
      title: formatNotificationTitle(notif.template, notif.channel),
      description: `Dispatched to customer via ${notif.channel || "WhatsApp"} (Status: ${notif.status})`,
      beforeValue: null,
      afterValue: null,
      statusBadge: notif.status,
      payload,
    });
  }

  // Map Payments
  for (const pay of payments) {
    let payload: Record<string, unknown> = {};
    try {
      if (pay.rawJson) payload = JSON.parse(pay.rawJson);
    } catch {}

    const formattedAmount = `₹${((pay.amountMinor || 0) / 100).toFixed(2)}`;

    timeline.push({
      id: `pay_${pay.id}`,
      source: "PAYMENT",
      timestamp: (pay.paidAt ?? pay.createdAt).toISOString(),
      actorName: pay.provider === "MANUAL" ? (payload.recordedBy ? (payload.recordedBy as any).name : "Finance Admin") : `${pay.provider} Gateway`,
      actorRole: "PAYMENT",
      action: `PAYMENT_${pay.status}`,
      title: `${pay.provider} Payment of ${formattedAmount}`,
      description: `Reference: ${pay.providerPaymentId}`,
      beforeValue: null,
      afterValue: pay.status,
      statusBadge: pay.status,
      payload,
    });
  }

  // Sort descending by timestamp
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return json({ timeline });
}

function formatEventTitle(type: string): string {
  switch (type) {
    case "APPROVED":
      return "Order Approved";
    case "REJECTED":
      return "Order Rejected";
    case "CANCELLED":
      return "Order Cancelled";
    case "DRAFT_UPDATED":
      return "Draft Order Modified";
    case "FULFILLMENT_PENDING":
      return "Fulfillment Initialized";
    case "FULFILLMENT_PACKING":
      return "Order Packing Started";
    case "FULFILLMENT_DISPATCHED":
      return "Order Dispatched & Stock Committed";
    case "FULFILLMENT_DELIVERED":
      return "Order Delivered to Customer";
    case "INVOICE_GENERATED":
      return "Official Tax Invoice Issued";
    case "INVOICE_VOIDED_REISSUED":
      return "Invoice Voided & Reissued";
    default:
      return type.replace(/_/g, " ");
  }
}

function formatNotificationTitle(template?: string | null, channel = "WhatsApp"): string {
  if (!template) return `Customer Update via ${channel}`;
  switch (template.toLowerCase()) {
    case "order_delivered":
      return "Customer Notified: Order Delivered";
    case "order_dispatched":
      return "Customer Notified: Order Dispatched & Tracking Shared";
    case "payment_received":
      return "Customer Notified: Payment Received";
    case "order_approved":
      return "Customer Notified: Order Approved & Confirmed";
    case "order_created":
      return "Customer Notified: Order Draft Created";
    case "invoice_issued":
      return "Customer Notified: Tax Invoice Shared";
    case "packing_started":
      return "Customer Notified: Order Packing Started";
    default: {
      const clean = template
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return `Customer Notified: ${clean}`;
    }
  }
}
