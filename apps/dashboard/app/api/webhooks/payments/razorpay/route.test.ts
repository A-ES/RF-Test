import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const TEST_SECRET = "rzp_webhook_secret_test";

const h = vi.hoisted(() => {
  const verifyWebhookSignature = vi.fn(
    (payload: string, signature: string, secret: string) => {
      const expected = createHmac("sha256", secret).update(payload).digest("hex");
      return signature === expected;
    },
  );

  return {
    verifyWebhookSignature,
    provider: {
      verifyWebhookSignature,
    },
  };
});

vi.mock("@/app/lib/payments/provider", () => ({
  getPaymentProvider: () => h.provider,
}));
vi.mock("@/app/lib/payments/service", () => ({
  applyPaymentEvent: vi.fn(async () => ({
    success: true,
    isReplay: false,
    payment: { id: "pay_1", organizationId: "org_1", status: "SUCCESS" },
  })),
}));
vi.mock("@/app/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 100, resetTime: Date.now() + 60000 }),
  createRateLimitHeaders: () => ({}),
}));
vi.mock("@/app/lib/db", () => ({
  prisma: {
    order: {
      findUnique: vi.fn(async () => ({ organizationId: "org_test" })),
    },
  },
}));

import { POST } from "./route";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("POST /api/webhooks/payments/razorpay", () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_SECRET;
    vi.clearAllMocks();
  });

  it("returns 500 when RAZORPAY_WEBHOOK_SECRET is unset", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const req = new Request("http://localhost/api/webhooks/payments/razorpay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("returns 401 when x-razorpay-signature header is missing", async () => {
    const req = new Request("http://localhost/api/webhooks/payments/razorpay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "payment.captured" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Missing x-razorpay-signature header");
  });

  it("returns 401 when signature does not match (before parsing body)", async () => {
    const rawBody = JSON.stringify({ event: "payment.captured" });
    const req = new Request("http://localhost/api/webhooks/payments/razorpay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": "invalid_hex_signature",
      },
      body: rawBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Invalid webhook signature");
  });

  it("returns 200 when signature matches valid payload", async () => {
    const rawBody = JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            id: "plink_1",
            notes: { orderId: "ord_test_1" },
          },
        },
        payment: { entity: { id: "pay_1", amount: 1000 } },
      },
    });
    const validSig = sign(rawBody, TEST_SECRET);

    const req = new Request("http://localhost/api/webhooks/payments/razorpay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": validSig,
      },
      body: rawBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
