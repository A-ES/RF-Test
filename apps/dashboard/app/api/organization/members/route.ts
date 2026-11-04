import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * List all members (non-RF-team) of the caller's organization.
 * Available to any authenticated user.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const members = await prisma.user.findMany({
    where: {
      organizationId: session.organizationId,
      isRFTeam: false,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      avatarInitials: true,
      createdAt: true,
    },
  });

  return json({ members });
}
