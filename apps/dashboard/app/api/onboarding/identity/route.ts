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
    companyName?: string;
    businessType?: string;
    customBusinessType?: string;
    website?: string;
    companySize?: string;
    location?: string;
    description?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    companyName,
    businessType,
    customBusinessType,
    website,
    companySize,
    location,
    description,
  } = body;

  if (!companyName || !companyName.trim()) {
    return Response.json({ error: "Company or organization name is required" }, { status: 400 });
  }

  if (!businessType || !businessType.trim()) {
    return Response.json({ error: "Please select an industry / business type" }, { status: 400 });
  }

  if (businessType === "Other" && (!customBusinessType || !customBusinessType.trim())) {
    return Response.json({ error: "Please specify your business type" }, { status: 400 });
  }

  // Save to organization and organization_onboardings
  await prisma.$transaction([
    prisma.organization.update({
      where: { id: session.organizationId },
      data: { name: companyName.trim() },
    }),
    prisma.organizationOnboarding.upsert({
      where: { organizationId: session.organizationId },
      create: {
        organizationId: session.organizationId,
        companyName: companyName.trim(),
        businessType: businessType.trim(),
        customBusinessType: customBusinessType?.trim() || null,
        website: website?.trim() || null,
        companySize: companySize?.trim() || null,
        location: location?.trim() || null,
        description: description?.trim() || null,
        currentStep: 4, // Next: Understand the business
      },
      update: {
        companyName: companyName.trim(),
        businessType: businessType.trim(),
        customBusinessType: customBusinessType?.trim() || null,
        website: website?.trim() || null,
        companySize: companySize?.trim() || null,
        location: location?.trim() || null,
        description: description?.trim() || null,
        currentStep: 4,
      },
    }),
  ]);

  return Response.json({
    ok: true,
    nextStep: 4,
    companyName: companyName.trim(),
    businessType: businessType.trim(),
  });
}
