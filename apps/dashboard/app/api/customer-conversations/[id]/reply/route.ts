/**
 * POST /api/customer-conversations/:id/reply
 *
 * Sends an employee reply to a customer via the original channel.
 *
 * Authorization
 * ─────────────
 * Any authenticated employee may reply to a conversation that is:
 *   – assigned to them  (CLIENT_EMPLOYEE)
 *   – or any conv in their org (CLIENT_ADMIN / ADMIN / MEMBER)
 *
 * Flow
 * ────
 * 1. Authenticate session
 * 2. Load and authorize the conversation
 * 3. Validate the request body (body text, optional markResolved flag)
 * 4. Resolve outbound addressing (inbox identifier + customer contact)
 * 5. Deliver via MessagingProvider (WhatsApp / Email / …)
 * 6. Persist CustomerMessage (sender: EMPLOYEE) with provider message id
 * 7. Update conversation status:
 *      markResolved=true  → RESOLVED
 *      default            → WAITING_FOR_CUSTOMER
 *    and refresh lastMessageAt / lastMessagePreview
 * 8. Write audit log
 * 9. Return the persisted message
 */
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { messagingProviderFor } from "@/app/lib/messaging/providers";
import { resolveOutboundAddressing } from "@/app/lib/messaging/outbound";
import { writeAuditLog } from "@/app/lib/audit";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_LENGTH = 4000;
const PREVIEW_LENGTH = 180;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function preview(text: string): string {
  return text.length > PREVIEW_LENGTH
    ? `${text.slice(0, PREVIEW_LENGTH - 1)}…`
    : text;
}

function canAccess(
  session: { role: string; userId: string },
  assignedEmployeeId: string | null,
): boolean {
  if (session.role === "CLIENT_EMPLOYEE") {
    return assignedEmployeeId === session.userId;
  }
  return true; // CLIENT_ADMIN, ADMIN, MEMBER
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/customer-conversations/[id]/reply">,
): Promise<Response> {
  // ── 1. Auth ─────────────────────────────────────────────────────────────
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id } = await ctx.params;

  // ── 2. Load & authorize ─────────────────────────────────────────────────
  const conversation = await prisma.customerConversation.findFirst({
    where: { id, organizationId: session.organizationId },
    select: {
      id: true,
      channel: true,
      status: true,
      assignedEmployeeId: true,
      customer: {
        select: {
          id: true,
          name: true,
          whatsapp: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  if (!conversation) return json({ error: "Conversation not found" }, 404);

  if (!canAccess(session, conversation.assignedEmployeeId)) {
    return json({ error: "Forbidden" }, 403);
  }

  // Guard: don't allow replies to permanently closed conversations
  if (conversation.status === "CLOSED") {
    return json({ error: "Cannot reply to a closed conversation" }, 409);
  }

  // ── 3. Validate body ────────────────────────────────────────────────────
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const markResolved = body.markResolved === true;

  if (!text) return json({ error: "A message body is required" }, 400);
  if (text.length > MAX_BODY_LENGTH) {
    return json(
      { error: `Message must be ${MAX_BODY_LENGTH} characters or fewer` },
      400,
    );
  }

  // ── 4. Resolve outbound addressing ──────────────────────────────────────
  let addressing: Awaited<ReturnType<typeof resolveOutboundAddressing>>;
  try {
    addressing = await resolveOutboundAddressing(
      session.organizationId,
      conversation.id,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: `Cannot deliver message: ${message}` }, 422);
  }

  // ── 5. Deliver via provider ─────────────────────────────────────────────
  const provider = messagingProviderFor(addressing.channel);
  let providerMessageId: string | undefined;
  try {
    const result = await provider.sendOutbound({
      inboxIdentifier: addressing.inboxIdentifier,
      contactIdentifier: addressing.contactIdentifier,
      body: text,
    });
    providerMessageId = result.providerMessageId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reply] provider delivery failed", {
      conversationId: id,
      channel: addressing.channel,
      error: message,
    });
    return json({ error: `Message delivery failed: ${message}` }, 502);
  }

  // ── 6 & 7. Persist message + update conversation ─────────────────────────
  const now = new Date();
  const newStatus = markResolved ? "RESOLVED" : "WAITING_FOR_CUSTOMER";

  const [message] = await prisma.$transaction([
    prisma.customerMessage.create({
      data: {
        organizationId: session.organizationId,
        conversationId: conversation.id,
        sender: "EMPLOYEE",
        body: text,
        providerMessageId: providerMessageId ?? null,
        createdAt: now,
      },
    }),
    prisma.customerConversation.update({
      where: { id: conversation.id },
      data: {
        status: newStatus,
        lastMessageAt: now,
        lastMessagePreview: preview(text),
        ...(newStatus === "RESOLVED" ? { resolvedAt: now } : {}),
      },
    }),
  ]);

  // ── 8. Audit ────────────────────────────────────────────────────────────
  await writeAuditLog({
    organizationId: session.organizationId,
    userId: session.userId,
    action: "customer_conversation.employee_replied",
    entityType: "CustomerConversation",
    entityId: conversation.id,
    metadata: {
      messageId: message.id,
      channel: addressing.channel,
      providerMessageId: providerMessageId ?? null,
      markResolved,
      newStatus,
      employeeName: session.name,
      customerName: conversation.customer.name,
    },
  });

  // ── 9. Realtime push (best-effort) ──────────────────────────────────────
  await publishToChannel(
    orgChannel(session.organizationId, "messages"),
    REALTIME_EVENTS.messageCreated,
    {
      conversationId: conversation.id,
      message: {
        id: message.id,
        sender: "EMPLOYEE",
        body: text,
        createdAt: now.toISOString(),
        employeeName: session.name,
      },
      newStatus,
    },
  );

  return json(
    {
      message: {
        id: message.id,
        sender: "EMPLOYEE" as const,
        body: text,
        providerMessageId: providerMessageId ?? null,
        createdAt: now.toISOString(),
      },
      conversationStatus: newStatus,
    },
    201,
  );
}
