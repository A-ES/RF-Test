import { getPaymentProvider } from "@/app/lib/payments/provider";
import { applyPaymentEvent } from "@/app/lib/payments/service";
import { prisma } from "@/app/lib/db";
import { checkRateLimit, createRateLimitHeaders } from "@/app/lib/rate-limit";
import { logStructured } from "@/app/lib/structured-logger";
import type { PaymentStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  const rateLimitRes = checkRateLimit("webhook_razorpay", 120, 60_000);
  if (!rateLimitRes.allowed) {
    return json({ error: "Rate limit exceeded" }, 429, createRateLimitHeaders(rateLimitRes));
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
    return json({ error: "Webhook secret not configured" }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature) {
    return json({ error: "Missing x-razorpay-signature header" }, 400);
  }

  const provider = getPaymentProvider();
  const isValid = provider.verifyWebhookSignature(rawBody, signature, secret);

  // Requirement: Invalid signature changes nothing!
  if (!isValid) {
    return json({ error: "Invalid webhook signature" }, 400);
  }

  let eventPayload: Record<string, unknown>;
  try {
    eventPayload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const eventName = typeof eventPayload.event === "string" ? eventPayload.event : "";
  const payload = (eventPayload.payload ?? {}) as Record<string, unknown>;

  let orderId: string | null = null;
  let providerPaymentId: string | null = null;
  let amountMinor = 0;
  let status: PaymentStatus = "PENDING";

  // Map events: payment_link.paid, payment.captured, payment.failed, refund.processed
  if (eventName === "payment_link.paid") {
    const plink = ((payload.payment_link as Record<string, unknown>)?.entity ?? {}) as Record<string, unknown>;
    const payment = ((payload.payment as Record<string, unknown>)?.entity ?? {}) as Record<string, unknown>;

    const notes = (plink.notes || payment.notes || {}) as Record<string, string>;
    orderId = (typeof plink.reference_id === "string" ? plink.reference_id : null) || notes.orderId || null;
    providerPaymentId = (typeof payment.id === "string" ? payment.id : null) || (typeof plink.id === "string" ? plink.id : null);
    amountMinor = Number(payment.amount ?? plink.amount_paid ?? plink.amount ?? 0);
    status = "SUCCESS";
  } else if (eventName === "payment.captured") {
    const payment = ((payload.payment as Record<string, unknown>)?.entity ?? {}) as Record<string, unknown>;
    const notes = (payment.notes ?? {}) as Record<string, string>;
    orderId = notes.orderId || null;
    providerPaymentId = typeof payment.id === "string" ? payment.id : null;
    amountMinor = Number(payment.amount ?? 0);
    status = "SUCCESS";
  } else if (eventName === "payment.failed") {
    const payment = ((payload.payment as Record<string, unknown>)?.entity ?? {}) as Record<string, unknown>;
    const notes = (payment.notes ?? {}) as Record<string, string>;
    orderId = notes.orderId || null;
    providerPaymentId = typeof payment.id === "string" ? payment.id : null;
    amountMinor = Number(payment.amount ?? 0);
    status = "FAILED";
  } else if (eventName === "refund.processed") {
    const refund = ((payload.refund as Record<string, unknown>)?.entity ?? {}) as Record<string, unknown>;
    const notes = (refund.notes ?? {}) as Record<string, string>;
    orderId = notes.orderId || null;
    providerPaymentId = typeof refund.id === "string" ? refund.id : null;
    amountMinor = Number(refund.amount ?? 0);
    status = "REFUNDED";

    // If orderId not in refund notes, resolve from original payment
    if (!orderId && typeof refund.payment_id === "string") {
      const origPayment = await prisma.payment.findUnique({
        where: { providerPaymentId: refund.payment_id },
      });
      if (origPayment) {
        orderId = origPayment.orderId;
      }
    }
  } else {
    // Unhandled Razorpay event; return 200 acknowledging receipt
    return json({ received: true, ignored: true, event: eventName });
  }

  if (!orderId || !providerPaymentId) {
    return json({ error: "Could not resolve orderId or providerPaymentId from payload", event: eventName }, 422);
  }

  try {
    const result = await applyPaymentEvent({
      orderId,
      provider: "RAZORPAY",
      providerPaymentId,
      amountMinor,
      status,
      eventType: eventName,
      paidAt: new Date(),
      rawJson: rawBody,
    });

    logStructured("info", "Razorpay payment webhook processed", {
      orderId,
      organizationId: result.payment.organizationId,
      provider: "RAZORPAY",
      event: eventName,
      amountMinor,
      isReplay: result.isReplay,
    });

    return json({
      received: true,
      orderId,
      paymentId: result.payment.id,
      isReplay: result.isReplay,
      status: result.payment.status,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logStructured("error", "Razorpay payment webhook failed", {
      orderId,
      error: message,
    });
    return json({ error: message }, 500);
  }
}
