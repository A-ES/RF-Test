/**
 * Provider-agnostic payment abstraction types.
 * Designed to easily support Stripe, Razorpay, or simulated providers.
 */

export type PaymentMethodType = "CARD" | "UPI";

export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED";

export interface CardDetails {
  cardholderName: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
}

export interface UpiDetails {
  upiId: string;
}

export interface CreatePaymentSessionInput {
  organizationId: string;
  planId: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethodType;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentSessionResult {
  sessionId: string;
  reference: string;
  amount: number;
  currency: string;
  provider: string;
  status: PaymentStatus;
  createdAt: string;
}

export interface InitiatePaymentInput {
  reference: string;
  paymentMethod: PaymentMethodType;
  cardDetails?: CardDetails;
  upiDetails?: UpiDetails;
  simulateFailure?: boolean;
}

export interface PaymentVerificationResult {
  succeeded: boolean;
  reference: string;
  status: PaymentStatus;
  transactionId: string;
  errorMessage?: string;
  maskedDetails?: string;
  rawResponse?: Record<string, unknown>;
}

export interface PaymentProvider {
  name: string;

  /**
   * Initializes a checkout session / transaction record.
   */
  createPaymentSession(input: CreatePaymentSessionInput): Promise<PaymentSessionResult>;

  /**
   * Initiates payment execution (card submit or UPI collect request).
   */
  initiatePayment(input: InitiatePaymentInput): Promise<PaymentVerificationResult>;

  /**
   * Server-side verification of payment state against provider.
   */
  verifyPayment(reference: string): Promise<PaymentVerificationResult>;

  /**
   * Retrieves latest status of a payment.
   */
  getPaymentStatus(reference: string): Promise<{ status: PaymentStatus; reference: string; errorMessage?: string }>;
}
