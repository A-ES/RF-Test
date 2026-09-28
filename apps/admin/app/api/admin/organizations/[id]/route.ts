/**
 * GET /api/admin/organizations/:id
 *
 * Returns org header, user roster (no passwords), subscription, settings,
 * and 30-day usage metrics. No client business data (messages, projects, docs)
 * beyond what is needed to support the org from the admin console.
 */
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/organizations/[id]">,
) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      plan: true,
      createdAt: true,
      updatedAt: true,
      users: {
        orderBy: { createdAt: "asc" },
        // passwordHash is intentionally excluded — only the listed fields are returned
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isRFTeam: true,
          createdAt: true,
        },
      },
      subscriptions: {
        select: {
          id: true,
          status: true,
          seats: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          cancelAtPeriodEnd: true,
          canceledAt: true,
          externalCustomerId: true,
          externalSubscriptionId: true,
          createdAt: true,
          updatedAt: true,
          plan: {
            select: {
              id: true,
              slug: true,
              name: true,
              priceCents: true,
              currency: true,
              interval: true,
              seatLimit: true,
              customerLimit: true,
            },
          },
        },
        take: 1,
      },
      settings: {
        select: {
          id: true,
          aiProvider: true,
          aiModel: true,
          aiTemperature: true,
          aiMaxTokens: true,
          aiSystemPrompt: true,
          aiContextWindow: true,
          confidenceThreshold: true,
          escalationThreshold: true,
          autoReplyEnabled: true,
          featureFlagsJson: true,
          dataRetentionDays: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!org) return json({ error: "Organization not found" }, 404);

  // Pull off relation arrays before spreading so TypeScript knows what remains
  const { subscriptions, settings, ...orgBase } = org;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalMessages, messages30d, convByStatus, aiMessages30d, humanMessages30d] =
    await Promise.all([
      prisma.customerMessage.count({ where: { organizationId: id } }),
      prisma.customerMessage.count({
        where: { organizationId: id, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.customerConversation.groupBy({
        by: ["status"],
        where: { organizationId: id },
        _count: { id: true },
      }),
      prisma.customerMessage.count({
        where: { organizationId: id, sender: "AI", createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.customerMessage.count({
        where: {
          organizationId: id,
          sender: "EMPLOYEE",
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

  const statusMap = Object.fromEntries(
    convByStatus.map((r) => [r.status, r._count.id]),
  );

  return json({
    organization: {
      ...orgBase,
      subscription: subscriptions[0] ?? null,
      settings: settings ?? null,
    },
    usage: {
      totalMessages,
      messages30d,
      aiMessages30d,
      humanMessages30d,
      conversationsByStatus: statusMap,
    },
  });
}
