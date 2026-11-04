/**
 * GET /api/messaging/integrations
 * POST /api/messaging/integrations
 *
 * Provides real-time connection status, webhook diagnostics, and configuration
 * for WhatsApp Business and Inbound/Outbound Email for the current tenant.
 */

import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const host = url.origin;

  // 1. WhatsApp Configuration Check
  const waToken = !!process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const waSecret = !!process.env.WHATSAPP_APP_SECRET?.trim();
  const waVerifyToken = !!process.env.WHATSAPP_VERIFY_TOKEN?.trim();

  const waInbox = await prisma.messagingInbox.findFirst({
    where: { organizationId: session.organizationId, provider: "WHATSAPP" },
  });

  const lastWaMessage: any = await (prisma.customerMessage as any).findFirst({
    where: { organizationId: session.organizationId, conversation: { channel: "WHATSAPP" } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, status: true, providerMessageId: true },
  });

  let waStatus: "CONNECTED" | "CONFIGURATION_INCOMPLETE" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
  if (waToken && waSecret && waVerifyToken && waInbox) {
    waStatus = "CONNECTED";
  } else if (waToken || waSecret || waVerifyToken || waInbox) {
    waStatus = "CONFIGURATION_INCOMPLETE";
  }

  // 2. Email Configuration Check
  const resendApiKey = !!process.env.RESEND_API_KEY?.trim();
  const emailSecret = !!process.env.EMAIL_WEBHOOK_SECRET?.trim();
  const emailProvider = process.env.EMAIL_PROVIDER || "console";

  const emailInbox = await prisma.messagingInbox.findFirst({
    where: { organizationId: session.organizationId, provider: "EMAIL" },
  });

  const lastEmailMessage: any = await (prisma.customerMessage as any).findFirst({
    where: { organizationId: session.organizationId, conversation: { channel: "EMAIL" } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, status: true, providerMessageId: true, emailSubject: true },
  });

  let emailStatus: "CONNECTED" | "CONFIGURATION_INCOMPLETE" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
  if ((resendApiKey || emailProvider === "console") && emailInbox) {
    emailStatus = "CONNECTED";
  } else if (resendApiKey || emailSecret || emailInbox) {
    emailStatus = "CONFIGURATION_INCOMPLETE";
  }

  return json({
    whatsapp: {
      status: waStatus,
      phoneNumberId: waInbox?.externalAddress || null,
      displayLabel: waInbox?.displayLabel || null,
      webhookUrl: `${host}/api/webhooks/whatsapp`,
      hasAccessToken: waToken,
      hasAppSecret: waSecret,
      hasVerifyToken: waVerifyToken,
      lastWebhookAt: lastWaMessage?.createdAt || null,
      lastMessageStatus: lastWaMessage?.status || null,
    },
    email: {
      status: emailStatus,
      inboundMailbox: emailInbox?.externalAddress || null,
      displayLabel: emailInbox?.displayLabel || null,
      webhookUrl: `${host}/api/webhooks/email`,
      provider: resendApiKey ? "Resend" : emailProvider,
      hasWebhookSecret: emailSecret,
      hasApiKey: resendApiKey,
      lastWebhookAt: lastEmailMessage?.createdAt || null,
      lastEmailSubject: lastEmailMessage?.emailSubject || null,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role === "CLIENT_EMPLOYEE") return json({ error: "Forbidden" }, 403);

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { provider, externalAddress, displayLabel } = body;
  if (!provider || !["WHATSAPP", "EMAIL"].includes(provider)) {
    return json({ error: "Invalid provider. Must be WHATSAPP or EMAIL" }, 400);
  }

  if (!externalAddress || typeof externalAddress !== "string") {
    return json({ error: "externalAddress is required (Meta Phone Number ID or Inbound Email address)" }, 400);
  }

  const cleanAddress = externalAddress.trim().toLowerCase();

  // Upsert MessagingInbox
  const inbox = await prisma.messagingInbox.upsert({
    where: {
      provider_externalAddress: {
        provider,
        externalAddress: cleanAddress,
      },
    },
    update: {
      organizationId: session.organizationId,
      displayLabel: displayLabel?.trim() || null,
    },
    create: {
      organizationId: session.organizationId,
      provider,
      externalAddress: cleanAddress,
      displayLabel: displayLabel?.trim() || null,
    },
  });

  return json({
    success: true,
    inbox,
    message: `${provider} inbox registered for your organization successfully.`,
  });
}
