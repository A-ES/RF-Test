/**
 * GET  /api/admin/organizations/:id/settings  — read OrganizationSettings
 * PATCH /api/admin/organizations/:id/settings  — update AI config + feature flags
 *
 * This is the only write path for OrganizationSettings. Every change is
 * recorded in AdminAuditLog so there is a full trail of who changed what.
 */
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/organizations/[id]/settings">,
) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!org) return json({ error: "Organization not found" }, 404);

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: id },
  });

  return json({ settings });
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/admin/organizations/[id]/settings">,
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

  // Build a validated update — only accepted fields, each individually coerced
  const update: Record<string, unknown> = {};

  if (typeof body.aiProvider === "string" && body.aiProvider.trim()) {
    update.aiProvider = body.aiProvider.trim();
  }
  if (typeof body.aiModel === "string" && body.aiModel.trim()) {
    update.aiModel = body.aiModel.trim();
  }
  if (typeof body.aiSystemPrompt === "string") {
    update.aiSystemPrompt = body.aiSystemPrompt;
  }
  if (typeof body.aiTemperature === "number") {
    update.aiTemperature = Math.min(2, Math.max(0, body.aiTemperature));
  }
  if (typeof body.aiMaxTokens === "number") {
    update.aiMaxTokens = Math.min(32_768, Math.max(128, Math.trunc(body.aiMaxTokens)));
  }
  if (typeof body.aiContextWindow === "number") {
    update.aiContextWindow = Math.min(40, Math.max(1, Math.trunc(body.aiContextWindow)));
  }
  if (typeof body.confidenceThreshold === "number") {
    update.confidenceThreshold = Math.min(1, Math.max(0, body.confidenceThreshold));
  }
  if (typeof body.escalationThreshold === "number") {
    update.escalationThreshold = Math.min(1, Math.max(0, body.escalationThreshold));
  }
  if (typeof body.autoReplyEnabled === "boolean") {
    update.autoReplyEnabled = body.autoReplyEnabled;
  }
  if (body.dataRetentionDays === null) {
    update.dataRetentionDays = null;
  } else if (typeof body.dataRetentionDays === "number") {
    update.dataRetentionDays = Math.max(1, Math.trunc(body.dataRetentionDays));
  }
  // Feature flags: merge the incoming object into the stored JSON
  if (body.featureFlagsJson !== undefined) {
    if (typeof body.featureFlagsJson !== "string") {
      return json({ error: "featureFlagsJson must be a JSON string" }, 400);
    }
    try {
      JSON.parse(body.featureFlagsJson); // validate it is parseable
    } catch {
      return json({ error: "featureFlagsJson is not valid JSON" }, 400);
    }
    update.featureFlagsJson = body.featureFlagsJson;
  }

  if (Object.keys(update).length === 0) {
    return json({ error: "No valid fields supplied" }, 400);
  }

  // Upsert: OrganizationSettings might not exist yet for older orgs
  const settings = await prisma.organizationSettings.upsert({
    where: { organizationId: id },
    create: { organizationId: id, ...update },
    update,
  });

  await recordAuditEvent(
    {
      adminId: auth.session.adminId,
      action: "org_settings.updated",
      entityType: "OrganizationSettings",
      entityId: settings.id,
      organizationId: id,
      metadata: { fields: Object.keys(update), ...update },
    },
    request,
  );

  return json({ settings });
}
