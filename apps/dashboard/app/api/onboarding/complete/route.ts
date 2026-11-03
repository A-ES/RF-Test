import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { writeAuditLog } from "@/app/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  await prisma.organizationOnboarding.upsert({
    where: { organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      completed: true,
      currentStep: 7,
      completedAt: now,
    },
    update: {
      completed: true,
      currentStep: 7,
      completedAt: now,
    },
  });

  await writeAuditLog({
    organizationId: session.organizationId,
    userId: session.userId,
    action: "ONBOARDING_COMPLETED",
    entityType: "ORGANIZATION",
    entityId: session.organizationId,
    metadata: { completedAt: now.toISOString() },
  }).catch(() => {});

  return Response.json({
    ok: true,
    redirectTo: "/dashboard",
  });
}
