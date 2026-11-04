import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { getOrganizationOnboardingStatus } from "@/app/lib/payment/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [onboardingStatus, plans, ownerUser] = await Promise.all([
    getOrganizationOnboardingStatus(session.organizationId),
    prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        priceCents: true,
        currency: true,
        interval: true,
        seatLimit: true,
        featuresJson: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarInitials: true,
      },
    }),
  ]);

  const parsedPlans = plans.map((p) => {
    let features: string[] = [];
    try {
      features = JSON.parse(p.featuresJson);
    } catch {
      features = [];
    }
    return {
      ...p,
      features,
    };
  });

  return Response.json({
    session: {
      userId: session.userId,
      organizationId: session.organizationId,
      name: session.name,
      email: session.email,
      role: session.role,
      avatarInitials: session.avatarInitials,
    },
    owner: ownerUser,
    status: onboardingStatus,
    plans: parsedPlans,
  });
}
