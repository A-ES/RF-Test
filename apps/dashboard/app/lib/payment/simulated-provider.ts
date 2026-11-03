import { randomBytes } from "node:crypto";
import {
  PaymentProvider,
  CreatePaymentSessionInput,
  PaymentSessionResult,
  InitiatePaymentInput,
  PaymentVerificationResult,
  PaymentStatus,
} from "./types";
import { prisma } from "@/app/lib/db";

/**
 * Simulated Payment Provider
 *
 * Implements the PaymentProvider abstraction.
 * Completely dummy / sandboxed: never stores real CVV or full raw card credentials.
 * Simulates real provider callbacks, deterministic success/failure paths, and server-side verification.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  public readonly name = "simulated";

  async createPaymentSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult> {
    const reference = `sim_ref_${randomBytes(10).toString("hex")}`;
    const now = new Date();

    // Check idempotency if key was supplied
    if (input.idempotencyKey) {
      const existing = await prisma.paymentTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return {
          sessionId: existing.id,
          reference: existing.reference,
          amount: existing.amount,
          currency: existing.currency,
          provider: existing.provider,
          status: existing.status as PaymentStatus,
          createdAt: existing.createdAt.toISOString(),
        };
      }
    }

    const transaction = await prisma.paymentTransaction.create({
      data: {
        organizationId: input.organizationId,
        planId: input.planId,
        provider: this.name,
        reference,
        idempotencyKey: input.idempotencyKey,
        amount: input.amount,
        currency: input.currency,
        status: "PENDING",
        paymentMethod: input.paymentMethod,
        maskedDetails: null,
        rawResponse: JSON.stringify({
          provider: this.name,
          mode: "sandbox",
          sessionCreated: now.toISOString(),
          metadata: input.metadata ?? {},
        }),
      },
    });

    return {
      sessionId: transaction.id,
      reference: transaction.reference,
      amount: transaction.amount,
      currency: transaction.currency,
      provider: transaction.provider,
      status: "PENDING",
      createdAt: transaction.createdAt.toISOString(),
    };
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<PaymentVerificationResult> {
    // Artificial latency to mirror real gateway round-trip (400ms)
    await new Promise((resolve) => setTimeout(resolve, 400));

    const transaction = await prisma.paymentTransaction.findUnique({
      where: { reference: input.reference },
    });

    if (!transaction) {
      return {
        succeeded: false,
        reference: input.reference,
        status: "FAILED",
        transactionId: "",
        errorMessage: "Payment session not found or expired.",
      };
    }

    // Already completed (idempotency guard)
    if (transaction.status === "SUCCEEDED") {
      return {
        succeeded: true,
        reference: transaction.reference,
        status: "SUCCEEDED",
        transactionId: transaction.id,
        maskedDetails: transaction.maskedDetails ?? undefined,
      };
    }

    let maskedDetails = "Simulated Payment";
    let failureReason: string | null = null;

    if (input.simulateFailure) {
      failureReason = "Payment was declined by the simulated payment processor.";
    }

    if (input.paymentMethod === "CARD") {
      const card = input.cardDetails;
      if (!card || !card.cardNumber || !card.expiry || !card.cvv) {
        failureReason = "Invalid or incomplete card credentials.";
      } else {
        const cleanNumber = card.cardNumber.replace(/\s+/g, "");
        if (cleanNumber.length < 13 || cleanNumber.length > 19) {
          failureReason = "Invalid card number length.";
        } else if (cleanNumber.endsWith("0000") || card.cvv === "000") {
          failureReason = "Simulated card authorization failed: Insufficient funds or declined by issuing bank.";
        }
        const last4 = cleanNumber.slice(-4);
        maskedDetails = `Card ending in •••• ${last4}`;
      }
    } else if (input.paymentMethod === "UPI") {
      const upi = input.upiDetails;
      if (!upi || !upi.upiId || !upi.upiId.includes("@")) {
        failureReason = "A valid Virtual Payment Address (UPI ID) is required.";
      } else if (upi.upiId.toLowerCase().startsWith("fail") || upi.upiId.toLowerCase().startsWith("decline")) {
        failureReason = "Simulated UPI authorization rejected by customer VPA.";
      } else {
        const [handle, psp] = upi.upiId.split("@");
        const maskedHandle = handle.length > 3 ? `${handle.slice(0, 2)}***${handle.slice(-1)}` : `${handle}***`;
        maskedDetails = `UPI: ${maskedHandle}@${psp}`;
      }
    }

    const succeeded = !failureReason;
    const newStatus: PaymentStatus = succeeded ? "SUCCEEDED" : "FAILED";

    const updated = await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: newStatus,
        paymentMethod: input.paymentMethod,
        maskedDetails: succeeded ? maskedDetails : null,
        errorMessage: failureReason,
        rawResponse: JSON.stringify({
          provider: this.name,
          mode: "sandbox",
          processedAt: new Date().toISOString(),
          decision: succeeded ? "APPROVED" : "DECLINED",
          authCode: succeeded ? `AUTH_${randomBytes(4).toString("hex").toUpperCase()}` : null,
          reason: failureReason,
        }),
      },
    });

    return {
      succeeded,
      reference: updated.reference,
      status: newStatus,
      transactionId: updated.id,
      errorMessage: failureReason ?? undefined,
      maskedDetails: succeeded ? maskedDetails : undefined,
    };
  }

  async verifyPayment(reference: string): Promise<PaymentVerificationResult> {
    const transaction = await prisma.paymentTransaction.findUnique({
      where: { reference },
    });

    if (!transaction) {
      return {
        succeeded: false,
        reference,
        status: "FAILED",
        transactionId: "",
        errorMessage: "Transaction reference not found",
      };
    }

    return {
      succeeded: transaction.status === "SUCCEEDED",
      reference: transaction.reference,
      status: transaction.status as PaymentStatus,
      transactionId: transaction.id,
      errorMessage: transaction.errorMessage ?? undefined,
      maskedDetails: transaction.maskedDetails ?? undefined,
    };
  }

  async getPaymentStatus(reference: string): Promise<{ status: PaymentStatus; reference: string; errorMessage?: string }> {
    const transaction = await prisma.paymentTransaction.findUnique({
      where: { reference },
      select: { status: true, reference: true, errorMessage: true },
    });

    if (!transaction) {
      return { status: "FAILED", reference, errorMessage: "Not found" };
    }

    return {
      status: transaction.status as PaymentStatus,
      reference: transaction.reference,
      errorMessage: transaction.errorMessage ?? undefined,
    };
  }
}
