/**
 * GET /api/admin/audit-log
 *
 * Paginated read of AdminAuditLog. Never exposes tenant AuditLog rows —
 * those are scoped to each client organization and never accessible here.
 *
 * Query params:
 *   adminId      – filter by RF admin actor
 *   orgId        – filter by affected organization
 *   action       – exact action string filter
 *   succeeded    – "true" | "false"
 *   limit        – default 50, max 200
 *   cursor       – createdAt ISO string for cursor-based pagination
 */
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function GET(request: Request) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const adminId = url.searchParams.get("adminId") ?? undefined;
  const orgId = url.searchParams.get("orgId") ?? undefined;
  const action = url.searchParams.get("action") ?? undefined;
  const succeededRaw = url.searchParams.get("succeeded");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(rawLimit)))
    : DEFAULT_LIMIT;

  const succeeded =
    succeededRaw === "true"
      ? true
      : succeededRaw === "false"
        ? false
        : undefined;

  const entries = await prisma.adminAuditLog.findMany({
    where: {
      ...(adminId ? { adminId } : {}),
      ...(orgId ? { organizationId: orgId } : {}),
      ...(action ? { action } : {}),
      ...(succeeded !== undefined ? { succeeded } : {}),
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to know if there's a next page
    select: {
      id: true,
      adminId: true,
      action: true,
      entityType: true,
      entityId: true,
      organizationId: true,
      targetEmail: true,
      ipAddress: true,
      userAgent: true,
      succeeded: true,
      metadataJson: true,
      createdAt: true,
    },
  });

  const hasMore = entries.length > limit;
  const rows = hasMore ? entries.slice(0, limit) : entries;
  const nextCursor = hasMore ? rows[rows.length - 1]?.createdAt.toISOString() : null;

  return json({ entries: rows, nextCursor, hasMore });
}
