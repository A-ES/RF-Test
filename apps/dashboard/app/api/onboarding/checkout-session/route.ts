import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { createCheckoutSession } from "@/app/lib/payment/service";
import type { PaymentMethodType } from "@/app/lib/payment/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { planId?: string; paymentMethod?: PaymentMethodType; idempotencyKey?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { planId, paymentMethod = "CARD", idempotencyKey } = body;
  if (!planId) {
    return Response.json({ error: "planId is required" }, { status: 400 });
  }

  const plan = await prisma.plan.findUnique({
    where: { id: planId },
  });

  if (!plan) {
    return Response.json({ error: "Plan not found" }, { status: 404 });
  }

  try {
    const paymentSession = await createCheckoutSession({
      organizationId: session.organizationId,
      planId: plan.id,
      amount: plan.priceCents,
      currency: plan.currency,
      paymentMethod,
      idempotencyKey,
      metadata: {
        userId: session.userId,
        planSlug: plan.slug,
        orgName: session.organization?.name,
      },
    });

    return Response.json({ session: paymentSession, plan });
  } catch (error) {
    console.error("Checkout session creation failed:", error);
    return Response.json(
      { error: "Failed to initialize payment session." },
      { status: 500 }
    );
  }
}
