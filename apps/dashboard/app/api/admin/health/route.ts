import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(): Promise<Response> {
  const startTime = Date.now();
  let dbStatus = "healthy";
  let dbLatencyMs = 0;

  try {
    const dbProbeStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbProbeStart;
  } catch {
    dbStatus = "unhealthy";
  }

  // 1. Queue lag: unhandled orders or pending jobs
  const pendingOrdersCount = await prisma.order.count({
    where: { status: "NEEDS_REVIEW" },
  });

  // 2. Last Webhook: latest received payment or inbound message
  const lastPayment = await prisma.payment.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, provider: true, status: true },
  });

  const lastCustomerMessage = await prisma.customerMessage.findFirst({
    where: { sender: "CUSTOMER" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, sender: true },
  });

  const lastWebhookTimestamp = [
    lastPayment?.createdAt?.getTime() ?? 0,
    lastCustomerMessage?.createdAt?.getTime() ?? 0,
  ].reduce((max, ts) => Math.max(max, ts), 0);

  // 3. Failed Notifications
  const failedNotificationsCount = await prisma.notificationLog.count({
    where: { status: "FAILED" },
  });

  // 4. ERP Failures
  const erpFailuresCount = await prisma.orderEvent.count({
    where: {
      OR: [
        { type: "ERP_SYNC_FAILED" },
        { payloadJson: { contains: "SYNC_FAILED" } },
      ],
    },
  });

  const overallStatus =
    dbStatus === "unhealthy"
      ? "unhealthy"
      : failedNotificationsCount > 10 || erpFailuresCount > 5
        ? "degraded"
        : "healthy";

  return json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
    },
    metrics: {
      queueLag: pendingOrdersCount,
      lastWebhook: lastWebhookTimestamp ? new Date(lastWebhookTimestamp).toISOString() : null,
      failedNotifications: failedNotificationsCount,
      erpFailures: erpFailuresCount,
    },
    version: "2.0.0",
  });
}
