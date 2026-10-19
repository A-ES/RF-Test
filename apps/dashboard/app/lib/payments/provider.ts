import { createHmac, timingSafeEqual } from "node:crypto";

export interface CreatePaymentLinkParams {
  amountMinor: number;
  currency: string;
  orderId: string;
  orderNumber: string;
  customer: {
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  description: string;
  notes?: Record<string, string>;
}

export interface PaymentLinkResult {
  id: string;
  url: string;
  qrCodeUrl?: string;
  status: "CREATED" | "SKIPPED_ON_TERMS";
  provider: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPaymentLink(params: CreatePaymentLinkParams): Promise<PaymentLinkResult>;
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
}

/**
 * Razorpay Payment Provider implementation.
 * Supports production API calls and local/test mode simulations.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "RAZORPAY";

  private readonly keyId: string | undefined;
  private readonly keySecret: string | undefined;

  constructor(options?: { keyId?: string; keySecret?: string }) {
    this.keyId = options?.keyId ?? process.env.RAZORPAY_KEY_ID;
    this.keySecret = options?.keySecret ?? process.env.RAZORPAY_KEY_SECRET;
  }

  async createPaymentLink(params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    // If keys are not configured or test mode mock requested, return predictable test link
    if (!this.keyId || !this.keySecret || this.keyId.includes("test_mock") || process.env.NODE_ENV === "test") {
      const mockId = `plink_test_${params.orderId.slice(-8)}`;
      return {
        id: mockId,
        url: `https://rzp.io/i/${mockId}`,
        qrCodeUrl: `https://api.razorpay.com/v1/payments/qr/${mockId}.png`,
        status: "CREATED",
        provider: this.name,
      };
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const payload = {
      amount: params.amountMinor,
      currency: params.currency || "INR",
      accept_partial: true,
      reference_id: params.orderId,
      description: params.description,
      customer: {
        name: params.customer.name,
        email: params.customer.email || undefined,
        contact: params.customer.phone || undefined,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        ...(params.notes ?? {}),
      },
    };

    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Razorpay payment link creation failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      id: string;
      short_url?: string;
      url?: string;
    };

    return {
      id: data.id,
      url: data.short_url || data.url || `https://rzp.io/i/${data.id}`,
      status: "CREATED",
      provider: this.name,
    };
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    if (!signature || !secret || !payload) return false;
    try {
      const expected = createHmac("sha256", secret).update(payload).digest("hex");
      const expectedBuf = Buffer.from(expected, "utf8");
      const signatureBuf = Buffer.from(signature.trim(), "utf8");

      if (expectedBuf.length !== signatureBuf.length) {
        return false;
      }
      return timingSafeEqual(expectedBuf, signatureBuf);
    } catch {
      return false;
    }
  }
}

/**
 * Fallback provider when online card/UPI payments are disabled for an organization.
 * Represents "Payment on terms" (e.g. Net 30 invoices with bank wire).
 */
export class TermsPaymentProvider implements PaymentProvider {
  readonly name = "TERMS";

  async createPaymentLink(params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    return {
      id: `terms_${params.orderId}`,
      url: "",
      status: "SKIPPED_ON_TERMS",
      provider: this.name,
    };
  }

  verifyWebhookSignature(): boolean {
    return false;
  }
}

let activePaymentProvider: PaymentProvider | null = null;

export function getPaymentProvider(paymentsEnabled = true): PaymentProvider {
  if (activePaymentProvider) {
    return activePaymentProvider;
  }
  if (!paymentsEnabled) {
    return new TermsPaymentProvider();
  }
  return new RazorpayPaymentProvider();
}

export function setPaymentProvider(provider: PaymentProvider | null): void {
  activePaymentProvider = provider;
}
