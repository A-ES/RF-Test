/**
 * GET /api/customer-conversations
 *
 * Returns a paginated list of CustomerConversation rows for the session's
 * organization.  CLIENT_ADMIN sees every conversation; CLIENT_EMPLOYEE sees
 * only conversations assigned to them (matching the access rule on Customer).
 *
 * Query params:
 *   limit    – max rows to return (1–100, default 50)
 *   status   – filter by CustomerConversationStatus enum value
 *   channel  – filter by CustomerConversationChannel enum value
 *   search   – substring match against customer name / company / last preview
 */
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import type {
  CustomerConversationStatus,
  CustomerConversationChannel,
} from "@rf-intelligence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function parseLimit(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(n)))
    : DEFAULT_LIMIT;
}

// Exhaustive sets so an arbitrary string can't be injected into the query
const VALID_STATUSES = new Set<CustomerConversationStatus>([
  "OPEN",
  "AI_HANDLING",
  "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_CLIENT",
  "HUMAN_ESCALATION",
  "RESOLVED",
  "CLOSED",
]);

const VALID_CHANNELS = new Set<CustomerConversationChannel>([
  "WHATSAPP",
  "EMAIL",
  "WEB_CHAT",
  "SMS",
]);

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const rawStatus = url.searchParams.get("status")?.toUpperCase();
  const rawChannel = url.searchParams.get("channel")?.toUpperCase();
  const search = url.searchParams.get("search")?.trim() ?? "";

  const statusFilter =
    rawStatus && VALID_STATUSES.has(rawStatus as CustomerConversationStatus)
      ? (rawStatus as CustomerConversationStatus)
      : undefined;

  const channelFilter =
    rawChannel && VALID_CHANNELS.has(rawChannel as CustomerConversationChannel)
      ? (rawChannel as CustomerConversationChannel)
      : undefined;

  const isEmployee = session.role === "CLIENT_EMPLOYEE";

  const conversations = await prisma.customerConversation.findMany({
    where: {
      organizationId: session.organizationId,
      ...(isEmployee ? { assignedEmployeeId: session.userId } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(channelFilter ? { channel: channelFilter } : {}),
      ...(search
        ? {
            OR: [
              { customer: { name: { contains: search, mode: "insensitive" } } },
              { customer: { company: { contains: search, mode: "insensitive" } } },
              { lastMessagePreview: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      channel: true,
      status: true,
      priority: true,
      subject: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      escalationReason: true,
      assignedEmployeeId: true,
      assignedEmployee: { select: { id: true, name: true } },
      customer: {
        select: {
          id: true,
          name: true,
          company: true,
          email: true,
          phone: true,
          whatsapp: true,
          status: true,
        },
      },
    },
  });

  return json({ conversations });
}
