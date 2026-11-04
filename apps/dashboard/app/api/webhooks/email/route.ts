/**
 * POST /api/webhooks/email
 *
 * Inbound Email Webhook.
 *
 * Security & Tenant Isolation:
 * - Signature validated via HMAC-SHA256 (or custom webhook secret header).
 * - Organization is resolved by destination mailbox (`to`) on MessagingInbox
 *   where provider = EMAIL.
 * - Never trusts any organizationId in the request.
 * - Deduplicates incoming messages by providerMessageId (RFC 822 Message-ID).
 * - Persists email headers for thread continuity (In-Reply-To, References, Subject).
 */

import { prisma } from "@/app/lib/db";
import { rateLimit } from "@/app/lib/rate-limit";
import {
  ingestInboundMessages,
  type MessagingStore,
} from "@/app/lib/messaging/ingest";
import {
  verifyEmailWebhookSignature,
  emailMessagingProvider,
} from "@/app/lib/messaging/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function GET(): Promise<Response> {
  return json({
    status: "ok",
    provider: "email",
    endpoint: "/api/webhooks/email",
    info: "Configured for inbound email webhooks. Use POST with JSON payload.",
  });
}

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(`email-webhook:${clientKey(request)}`, 120, 60_000);
  if (!limited.allowed) {
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds) },
    });
  }

  const rawBody = await request.text();
  const signature =
    request.headers.get("x-webhook-signature") ||
    request.headers.get("x-hub-signature-256") ||
    request.headers.get("x-signature") ||
    null;

  const secret = process.env.EMAIL_WEBHOOK_SECRET || "";
  if (secret && !verifyEmailWebhookSignature(rawBody, signature, secret)) {
    return json({ error: "Invalid webhook signature" }, 401);
  }

  const inbound = await emailMessagingProvider.parseInbound(rawBody);

  if (inbound.length === 0) {
    return json({ received: true, processed: 0, message: "No valid inbound emails in payload" });
  }

  const results = await ingestInboundMessages(
    prisma as unknown as MessagingStore,
    inbound,
  );

  return json({
    received: true,
    processed: results.length,
    results,
  }, 200);
}
