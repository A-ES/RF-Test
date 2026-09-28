/**
 * GET /api/admin/organizations
 *
 * Returns all client organizations with health indicators:
 *   – active user count, conversation volume (30 d), last activity, subscription status
 *
 * Query params:
 *   search  – substring match on org name (case-insensitive)
 *   limit   – max rows (default 100, max 500)
 *   offset  – pagination offset
 */
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET(request: Request) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(rawLimit)))
    : DEFAULT_LIMIT;
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) | 0);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const orgs = await prisma.organization.findMany({
    where: search
      ? { name: { contains: search, mode: "insensitive" } }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    select: {
      id: true,
      name: true,
      plan: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          users: true,
        },
      },
      subscriptions: {
        select: {
          status: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          cancelAtPeriodEnd: true,
          plan: { select: { name: true, slug: true } },
        },
        take: 1,
      },
    },
  });

  // Per-org 30-day message + conversation counts — batched as aggregate queries
  // rather than N+1 calls.
  const orgIds = orgs.map((o) => o.id);

  const [msgCounts, convCounts, lastActivities] = await Promise.all([
    // total customer messages in last 30 days
    prisma.customerMessage.groupBy({
      by: ["organizationId"],
      where: {
        organizationId: { in: orgIds },
        createdAt: { gte: thirtyDaysAgo },
      },
      _count: { id: true },
    }),
    // open / active conversation count
    prisma.customerConversation.groupBy({
      by: ["organizationId"],
      where: {
        organizationId: { in: orgIds },
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
      _count: { id: true },
    }),
    // latest message timestamp per org (last activity proxy)
    prisma.customerMessage.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgIds } },
      _max: { createdAt: true },
    }),
  ]);

  const msgMap = new Map(msgCounts.map((r) => [r.organizationId, r._count.id]));
  const convMap = new Map(convCounts.map((r) => [r.organizationId, r._count.id]));
  const lastMap = new Map(lastActivities.map((r) => [r.organizationId, r._max.createdAt]));

  const organizations = orgs.map((org) => ({
    id: org.id,
    name: org.name,
    plan: org.plan,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    userCount: org._count.users,
    messages30d: msgMap.get(org.id) ?? 0,
    activeConversations: convMap.get(org.id) ?? 0,
    lastActivityAt: lastMap.get(org.id) ?? null,
    subscription: org.subscriptions[0] ?? null,
  }));

  return json({ organizations, total: organizations.length });
}
