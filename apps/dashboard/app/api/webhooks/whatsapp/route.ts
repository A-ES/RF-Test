/**
 * POST /api/webhooks/whatsapp
 *
 * Inbound WhatsApp Cloud API messages. Organization is resolved by the
 * business `phone_number_id` on MessagingInbox — never from a query param
 * or payload field named organizationId.
 *
 * GET is Meta's subscription handshake (`hub.challenge` / `hub.verify_token`).
 */
import { prisma } from "@/app/lib/db";
import { rateLimit } from "@/app/lib/rate-limit";
import {
  ingestInboundMessages,
  type MessagingStore,
} from "@/app/lib/messaging/ingest";
import {
  verifyWhatsAppSignature,
  whatsappProvider,
} from "@/app/lib/messaging/whatsapp";

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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return json({ error: "Forbidden" }, 403);
}

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(`whatsapp-webhook:${clientKey(request)}`, 120, 60_000);
  if (!limited.allowed) {
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds) },
    });
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("messaging: WHATSAPP_APP_SECRET is not configured");
    return json({ error: "Webhook is not configured" }, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWhatsAppSignature(rawBody, signature, appSecret)) {
    return json({ error: "Invalid signature" }, 401);
  }

  const inbound = whatsappProvider.parseInbound(rawBody);
  await ingestInboundMessages(prisma as unknown as MessagingStore, inbound);

  return json({ received: true }, 200);
}
