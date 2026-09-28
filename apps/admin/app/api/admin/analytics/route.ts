/**
 * GET /api/admin/analytics
 *
 * System-wide aggregate metrics:
 *   - total/active client count
 *   - total users, messages (all-time + 30d), conversations
 *   - AI vs human resolution rate (30d)
 *   - subscription status breakdown
 *   - message volume by day (last 14 days) for a sparkline
 *   - error rate proxy: HUMAN_ESCALATION / total conversations (30d)
 */
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET() {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [
    totalOrgs,
    totalUsers,
    totalMessages,
    messages30d,
    aiMessages30d,
    humanMessages30d,
    totalConvs,
    convs30d,
    escalations30d,
    subscriptionBreakdown,
    dailyVolume,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.customerMessage.count(),
    prisma.customerMessage.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.customerMessage.count({
      where: { sender: "AI", createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.customerMessage.count({
      where: { sender: "EMPLOYEE", createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.customerConversation.count(),
    prisma.customerConversation.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.customerConversation.count({
      where: { status: "HUMAN_ESCALATION", createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.subscription.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    // Daily message counts for the last 14 days — raw SQL aggregate for efficiency
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT
        date_trunc('day', "createdAt") AS day,
        COUNT(*) AS count
      FROM customer_messages
      WHERE "createdAt" >= ${fourteenDaysAgo}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  ]);

  const subMap = Object.fromEntries(
    subscriptionBreakdown.map((r) => [r.status, r._count.id]),
  );

  // Normalise daily volume to a simple array with string dates
  const daily = dailyVolume.map((r) => ({
    day: r.day.toISOString().split("T")[0],
    count: Number(r.count),
  }));

  return json({
    totals: {
      organizations: totalOrgs,
      users: totalUsers,
      messages: totalMessages,
      conversations: totalConvs,
    },
    last30d: {
      messages: messages30d,
      aiMessages: aiMessages30d,
      humanMessages: humanMessages30d,
      conversations: convs30d,
      escalations: escalations30d,
      aiResolutionRate:
        aiMessages30d + humanMessages30d === 0
          ? null
          : aiMessages30d / (aiMessages30d + humanMessages30d),
      escalationRate: convs30d === 0 ? null : escalations30d / convs30d,
    },
    subscriptionBreakdown: subMap,
    dailyMessageVolume: daily,
  });
}
