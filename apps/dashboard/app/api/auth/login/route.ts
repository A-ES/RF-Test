import { createHash } from "node:crypto";
import { prisma } from "@/app/lib/db";
import { setSessionCookie } from "@/app/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign-in handler.
 *
 * Priority:
 *   1. If the user has a `passwordHash` (set when they accepted an invitation),
 *      verify against that SHA-256 hash.
 *   2. Otherwise fall back to the demo shared password (`AUTH_DEMO_PASSWORD`,
 *      default "password") so seed/demo users can still log in.
 */
import { withTiming } from "@/app/lib/timing";

export async function POST(request: Request): Promise<Response> {
  return withTiming("POST /api/auth/login", async () => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const body = (payload ?? {}) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, organizationId: true },
    });

    // Always run both checks to avoid timing-based user enumeration.
    const demoPassword = process.env.AUTH_DEMO_PASSWORD ?? "password";
    const incomingHash = createHash("sha256").update(password).digest("hex");

    const validViaHash =
      user?.passwordHash != null && user.passwordHash === incomingHash;
    const validViaDemo =
      (user?.passwordHash == null) && password === demoPassword;

    if (!user || (!validViaHash && !validViaDemo)) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    await setSessionCookie(user.id);

    // Compute post-login destination based on subscription & onboarding status
    const { getOrganizationOnboardingStatus } = await import("@/app/lib/payment/service");
    const status = await getOrganizationOnboardingStatus(user.organizationId);

    let redirectTo = "/dashboard";
    if (status.completed) {
      redirectTo = "/dashboard";
    } else if (!status.hasActiveSubscription) {
      redirectTo = "/onboarding/plan";
    } else {
      switch (status.currentStep) {
        case 1:
          redirectTo = "/onboarding/plan";
          break;
        case 2:
          redirectTo = "/onboarding/checkout";
          break;
        case 3:
          redirectTo = "/onboarding/identity";
          break;
        case 4:
          redirectTo = "/onboarding/business";
          break;
        case 5:
          redirectTo = "/onboarding/team";
          break;
        case 6:
          redirectTo = "/onboarding/presentation";
          break;
        default:
          redirectTo = "/dashboard";
          break;
      }
    }

    return Response.json({ ok: true, redirectTo });
  });
}
