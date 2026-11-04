import { getSession } from "@/app/lib/session";
import { executeAndConfirmPayment } from "@/app/lib/payment/service";
import type { PaymentMethodType, CardDetails, UpiDetails } from "@/app/lib/payment/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    reference?: string;
    planId?: string;
    paymentMethod?: PaymentMethodType;
    cardDetails?: CardDetails;
    upiDetails?: UpiDetails;
    simulateFailure?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    reference,
    planId,
    paymentMethod = "CARD",
    cardDetails,
    upiDetails,
    simulateFailure = false,
  } = body;

  if (!reference || !planId) {
    return Response.json(
      { error: "reference and planId are required" },
      { status: 400 }
    );
  }

  try {
    const result = await executeAndConfirmPayment({
      organizationId: session.organizationId,
      planId,
      reference,
      paymentMethod,
      cardDetails,
      upiDetails,
      simulateFailure,
    });

    if (!result.succeeded) {
      return Response.json(
        {
          error: result.errorMessage || "Payment declined.",
          status: result.status,
          reference: result.reference,
        },
        { status: 402 }
      );
    }

    return Response.json({
      ok: true,
      status: result.status,
      reference: result.reference,
      transactionId: result.transactionId,
      maskedDetails: result.maskedDetails,
      nextStep: 3, // Advances to Identity onboarding step
    });
  } catch (error) {
    console.error("Payment confirmation failed:", error);
    return Response.json(
      { error: "Payment processing failed. Please retry." },
      { status: 500 }
    );
  }
}
