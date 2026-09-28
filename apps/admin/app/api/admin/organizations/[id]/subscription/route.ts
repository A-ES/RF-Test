/**
 * GET  /api/admin/organizations/:id/subscription  — read subscription
 * PATCH /api/admin/organizations/:id/subscription  — update plan / status / seats
 *
 * Supported PATCH fields: planId, status, seats, cancelAtPeriodEnd,
 * trialEndsAt, currentPeriodEnd.
 * Every change is appended to AdminAuditLog.
 */
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import type { SubscriptionStatus } from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<SubscriptionStatus>([
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/organizations/[id]/subscription">,
) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const sub = await prisma.subscription.findUnique({
    where: { organizationId: id },
    include: { plan: true },
  });

  return json({ subscription: sub ?? null });
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/admin/organizations/[id]/subscription">,
) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!org) return json({ error: "Organization not found" }, 404);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const body = (payload ?? {}) as Record<string, unknown>;

  const update: Record<string, unknown> = {};

  // Plan change
  if (typeof body.planId === "string") {
    const plan = await prisma.plan.findUnique({
      where: { id: body.planId },
      select: { id: true },
    });
    if (!plan) return json({ error: "Plan not found" }, 400);
    update.planId = body.planId;
  }

  // Status
  const rawStatus =
    typeof body.status === "string" ? body.status.toUpperCase() : undefined;
  if (rawStatus) {
    if (!VALID_STATUSES.has(rawStatus as SubscriptionStatus)) {
      return json({ error: `Invalid status: ${body.status}` }, 400);
    }
    update.status = rawStatus;
    if (rawStatus === "CANCELED") update.canceledAt = new Date();
  }

  // Seats
  if (typeof body.seats === "number") {
    update.seats = Math.max(1, Math.trunc(body.seats));
  }

  // Cancel at period end
  if (typeof body.cancelAtPeriodEnd === "boolean") {
    update.cancelAtPeriodEnd = body.cancelAtPeriodEnd;
  }

  // Trial end date override
  if (body.trialEndsAt === null) {
    update.trialEndsAt = null;
  } else if (typeof body.trialEndsAt === "string") {
    const d = new Date(body.trialEndsAt);
    if (isNaN(d.getTime())) return json({ error: "Invalid trialEndsAt date" }, 400);
    update.trialEndsAt = d;
  }

  // Period end override
  if (typeof body.currentPeriodEnd === "string") {
    const d = new Date(body.currentPeriodEnd);
    if (isNaN(d.getTime())) return json({ error: "Invalid currentPeriodEnd date" }, 400);
    update.currentPeriodEnd = d;
  }

  if (Object.keys(update).length === 0) {
    return json({ error: "No valid fields supplied" }, 400);
  }

  const existing = await prisma.subscription.findUnique({
    where: { organizationId: id },
    select: { id: true },
  });

  const now = new Date();
  const periodEnd =
    (update.currentPeriodEnd as Date | undefined) ??
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // planId is required for subscription create
  const planId = update.planId as string | undefined;
  if (!existing && !planId) {
    return json({ error: "planId is required when creating a new subscription" }, 400);
  }

  const sub = existing
    ? await prisma.subscription.update({
        where: { organizationId: id },
        data: update,
        include: { plan: true },
      })
    : await prisma.subscription.create({
        data: {
          organizationId: id,
          planId: planId as string,
          status: update.status as Parameters<typeof prisma.subscription.create>[0]["data"]["status"],
          seats: (update.seats as number | undefined) ?? 1,
          cancelAtPeriodEnd: (update.cancelAtPeriodEnd as boolean | undefined) ?? false,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialEndsAt: update.trialEndsAt as Date | null | undefined,
          canceledAt: update.canceledAt as Date | undefined,
        },
        include: { plan: true },
      });

  await recordAuditEvent(
    {
      adminId: auth.session.adminId,
      action: "subscription.updated",
      entityType: "Subscription",
      entityId: sub.id,
      organizationId: id,
      metadata: { fields: Object.keys(update), ...update },
    },
    request,
  );

  return json({ subscription: sub });
}
