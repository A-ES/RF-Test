import { prisma } from "@/app/lib/db";
import { SimulatedPaymentProvider } from "./simulated-provider";
import {
  PaymentProvider,
  CreatePaymentSessionInput,
  InitiatePaymentInput,
  PaymentVerificationResult,
} from "./types";

// Registry of payment providers
const providers: Record<string, PaymentProvider> = {
  simulated: new SimulatedPaymentProvider(),
};

export function getPaymentProvider(name = "simulated"): PaymentProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unsupported payment provider: ${name}`);
  }
  return provider;
}

export interface OnboardingStatus {
  hasActiveSubscription: boolean;
  subscriptionPlan: string | null;
  seatLimit: number;
  currentStep: number;
  completed: boolean;
  companyName: string | null;
  businessType: string | null;
  invitedMembers: Array<{ name: string; email: string; role?: string }>;
}

/**
 * Checks subscription & onboarding state for any organization.
 * Existing organizations (e.g. org_acme with plan='Enterprise') or those with completed=true
 * are considered fully onboarded.
 */
export async function getOrganizationOnboardingStatus(
  organizationId: string
): Promise<OnboardingStatus> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      plan: true,
      subscriptions: {
        where: { status: "ACTIVE" },
        include: { plan: true },
        take: 1,
      },
      onboarding: true,
    },
  });

  if (!org) {
    return {
      hasActiveSubscription: false,
      subscriptionPlan: null,
      seatLimit: 1,
      currentStep: 1,
      completed: false,
      companyName: null,
      businessType: null,
      invitedMembers: [],
    };
  }

  // Grandfathered check: If org is Acme Corp or has Enterprise plan and no incomplete onboarding record
  const isGrandfathered =
    org.id === "org_acme" ||
    (org.plan === "Enterprise" && (!org.onboarding || org.onboarding.completed));

  if (isGrandfathered) {
    return {
      hasActiveSubscription: true,
      subscriptionPlan: org.plan,
      seatLimit: 20,
      currentStep: 7,
      completed: true,
      companyName: org.name,
      businessType: org.onboarding?.businessType ?? "Wholesale & Distribution",
      invitedMembers: [],
    };
  }

  const activeSub = org.subscriptions[0];
  const hasActiveSub = !!activeSub || org.plan !== "Free";
  const planSlug = activeSub?.plan?.slug ?? org.plan;
  const seatLimit = activeSub?.plan?.seatLimit ?? (planSlug === "rf-ultra" ? 11 : 5);

  let invitedMembersList: Array<{ name: string; email: string; role?: string }> = [];
  if (org.onboarding?.invitedMembers) {
    try {
      invitedMembersList = JSON.parse(org.onboarding.invitedMembers);
    } catch {
      invitedMembersList = [];
    }
  }

  return {
    hasActiveSubscription: hasActiveSub,
    subscriptionPlan: planSlug,
    seatLimit,
    currentStep: org.onboarding?.currentStep ?? (hasActiveSub ? 3 : 1),
    completed: org.onboarding?.completed ?? false,
    companyName: org.onboarding?.companyName ?? org.name,
    businessType: org.onboarding?.businessType ?? null,
    invitedMembers: invitedMembersList,
  };
}

/**
 * Creates checkout session and ensures Onboarding row exists.
 */
export async function createCheckoutSession(input: CreatePaymentSessionInput) {
  const provider = getPaymentProvider();
  const session = await provider.createPaymentSession(input);

  // Ensure organization_onboardings row is initialized at step 2 (checkout)
  await prisma.organizationOnboarding.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      currentStep: 2,
      completed: false,
    },
    update: {
      currentStep: 2,
    },
  });

  return session;
}

/**
 * Executes payment and on success activates subscription server-side.
 */
export async function executeAndConfirmPayment(
  input: InitiatePaymentInput & { organizationId: string; planId: string }
): Promise<PaymentVerificationResult> {
  const provider = getPaymentProvider();
  const result = await provider.initiatePayment(input);

  if (result.succeeded) {
    // Server-side verification before activating subscription
    const verification = await provider.verifyPayment(result.reference);
    if (!verification.succeeded) {
      return {
        succeeded: false,
        reference: result.reference,
        status: "FAILED",
        transactionId: result.transactionId,
        errorMessage: "Payment verification failed on the server.",
      };
    }

    // Load plan details for seat limits
    const plan = await prisma.plan.findUnique({
      where: { id: input.planId },
    });

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Upsert subscription
    await prisma.subscription.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        planId: input.planId,
        status: "ACTIVE",
        seats: plan?.seatLimit ?? 5,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
      update: {
        planId: input.planId,
        status: "ACTIVE",
        seats: plan?.seatLimit ?? 5,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
      },
    });

    // Update organization's plan name string
    await prisma.organization.update({
      where: { id: input.organizationId },
      data: { plan: plan?.name ?? "RF Pro" },
    });

    // Advance onboarding to Step 3 (Identity)
    await prisma.organizationOnboarding.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        currentStep: 3,
        completed: false,
      },
      update: {
        currentStep: 3,
      },
    });
  }

  return result;
}
