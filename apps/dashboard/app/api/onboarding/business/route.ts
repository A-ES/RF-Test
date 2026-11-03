import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    operationalActivities?: string[];
    challenges?: string[];
    monitoringAreas?: string[];
    alertPreferences?: string[];
    priorities?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    operationalActivities = [],
    challenges = [],
    monitoringAreas = [],
    alertPreferences = [],
    priorities = [],
  } = body;

  await prisma.organizationOnboarding.upsert({
    where: { organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      operationalActivities: JSON.stringify(operationalActivities),
      challenges: JSON.stringify(challenges),
      monitoringAreas: JSON.stringify(monitoringAreas),
      alertPreferences: JSON.stringify(alertPreferences),
      priorities: JSON.stringify(priorities),
      currentStep: 5, // Next: Team Setup
    },
    update: {
      operationalActivities: JSON.stringify(operationalActivities),
      challenges: JSON.stringify(challenges),
      monitoringAreas: JSON.stringify(monitoringAreas),
      alertPreferences: JSON.stringify(alertPreferences),
      priorities: JSON.stringify(priorities),
      currentStep: 5,
    },
  });

  return Response.json({
    ok: true,
    nextStep: 5,
  });
}
