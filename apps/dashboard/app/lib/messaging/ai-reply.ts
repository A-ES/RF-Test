import { prisma } from "@/app/lib/db";
import { writeAuditLog } from "@/app/lib/audit";
import { completeDeepSeekJson } from "@/app/lib/deepseek";
import { deliverNotifications } from "@/app/lib/notifications";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";
import type { CustomerMessageAiEventData } from "@/app/lib/inngest/client";
import type { OutboundMessage } from "@/app/lib/messaging/types";
import { messagingProviderFor } from "@/app/lib/messaging/providers";
import {
  isGroundingSufficient,
  messageRequiresGroundedFacts,
  retrieveCustomerReplyContext,
  type CustomerReplyContext,
} from "@/app/lib/messaging/context";

export interface OrgAiSettings {
  aiModel: string;
  aiTemperature: number;
  aiMaxTokens: number;
  aiSystemPrompt: string;
  aiContextWindow: number;
  confidenceThreshold: number;
  escalationThreshold: number;
  autoReplyEnabled: boolean;
}

export interface DraftReply {
  reply: string;
  confidence: number;
  needsHuman: boolean;
  reason: string;
}

export type AiReplyDecision =
  | "replied"
  | "escalated"
  | "skipped";

export interface ProcessCustomerAiReplyResult {
  decision: AiReplyDecision;
  organizationId: string;
  conversationId: string;
  reason: string;
  confidence: number | null;
  assignedEmployeeId: string | null;
  sent: boolean;
}

export interface AiReplyDeps {
  retrieveContext: typeof retrieveCustomerReplyContext;
  completeJson: typeof completeDeepSeekJson;
  sendOutbound: (channel: CustomerReplyContext["conversation"]["channel"], message: OutboundMessage) => Promise<{ providerMessageId?: string }>;
  loadSettings: (organizationId: string) => Promise<OrgAiSettings>;
}

const SETTINGS_FALLBACK: OrgAiSettings = {
  aiModel: "deepseek-chat",
  aiTemperature: 0.2,
  aiMaxTokens: 2048,
  aiSystemPrompt:
    "You are a helpful sales operations assistant for RF Intelligence.",
  aiContextWindow: 6,
  confidenceThreshold: 0.75,
  escalationThreshold: 0.6,
  autoReplyEnabled: true,
};

async function defaultLoadSettings(organizationId: string): Promise<OrgAiSettings> {
  const row = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: {
      aiModel: true,
      aiTemperature: true,
      aiMaxTokens: true,
      aiSystemPrompt: true,
      aiContextWindow: true,
      confidenceThreshold: true,
      escalationThreshold: true,
      autoReplyEnabled: true,
    },
  });
  return row ?? SETTINGS_FALLBACK;
}

async function defaultSendOutbound(
  channel: CustomerReplyContext["conversation"]["channel"],
  message: OutboundMessage,
): Promise<{ providerMessageId?: string }> {
  return messagingProviderFor(channel).sendOutbound(message);
}

export function parseDraftReply(payload: Record<string, unknown>): DraftReply {
  const confidenceRaw = payload.confidence;
  const confidence =
    typeof confidenceRaw === "number"
      ? confidenceRaw
      : Number.parseFloat(String(confidenceRaw ?? ""));
  const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
  const reason =
    typeof payload.reason === "string" && payload.reason.trim()
      ? payload.reason.trim()
      : "no reason supplied";
  const needsHuman = payload.needsHuman === true || payload.needs_human === true;
  return {
    reply,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    needsHuman,
    reason,
  };
}

export function shouldAutoReply(input: {
  settings: OrgAiSettings;
  draft: DraftReply;
  groundingSufficient: boolean;
  inboundBody: string;
}): { reply: boolean; reason: string } {
  if (!input.settings.autoReplyEnabled) {
    return { reply: false, reason: "auto_reply_disabled" };
  }
  if (input.draft.needsHuman) {
    return { reply: false, reason: "model_requested_human" };
  }
  if (
    messageRequiresGroundedFacts(input.inboundBody) &&
    !input.groundingSufficient
  ) {
    return { reply: false, reason: "insufficient_grounding" };
  }
  if (input.draft.confidence < input.settings.escalationThreshold) {
    return { reply: false, reason: "below_escalation_threshold" };
  }
  if (input.draft.confidence < input.settings.confidenceThreshold) {
    return { reply: false, reason: "below_confidence_threshold" };
  }
  if (!input.draft.reply) {
    return { reply: false, reason: "empty_draft" };
  }
  return { reply: true, reason: "confident" };
}

function formatContextBlock(
  ctx: CustomerReplyContext,
  window: number,
): string {
  const tags = (() => {
    try {
      const parsed = JSON.parse(ctx.customer.tagsJson) as unknown;
      return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string").join(", ") : "";
    } catch {
      return "";
    }
  })();

  const profile = [
    `Name: ${ctx.customer.name}`,
    ctx.customer.company ? `Company: ${ctx.customer.company}` : null,
    `Status: ${ctx.customer.status}`,
    tags ? `Tags: ${tags}` : null,
    ctx.customer.orderReference
      ? `Order history reference: ${ctx.customer.orderReference}`
      : "Order history reference: (none on file)",
    ctx.customer.internalNotes
      ? `Internal notes: ${ctx.customer.internalNotes}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const thread = [...ctx.priorMessages, ctx.inbound]
    .map((message) => `${message.sender}: ${message.body}`)
    .join("\n");

  const others = ctx.otherConversations.length
    ? ctx.otherConversations
        .map(
          (row) =>
            `- [${row.channel}/${row.status}] ${row.subject ?? "untitled"}: ${row.lastMessagePreview ?? ""}`,
        )
        .join("\n")
    : "(none)";

  const sources = ctx.workspaceSources.slice(0, Math.max(1, window));
  const workspace = sources.length
    ? sources
        .map(
          (source, index) =>
            `[S${index + 1}] (${source.type}) ${source.title}\n${source.summary}`,
        )
        .join("\n\n")
    : "(no customer-matching insights, projects, or documents)";

  return [
    "CUSTOMER PROFILE (this organization only):",
    profile,
    "",
    "THIS THREAD:",
    thread || "(empty)",
    "",
    "OTHER CONVERSATIONS WITH THIS CUSTOMER:",
    others,
    "",
    "WORKSPACE SOURCES MATCHING THIS CUSTOMER:",
    workspace,
  ].join("\n");
}

export function buildDraftPrompts(
  ctx: CustomerReplyContext,
  settings: OrgAiSettings,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    settings.aiSystemPrompt,
    "You are drafting a reply to a customer of exactly ONE organization.",
    "Use ONLY the supplied context. Never invent orders, prices, dates, SKUs, discounts, or commitments.",
    "If the context is not enough to answer accurately, set needsHuman to true and keep confidence low.",
    'Respond with a JSON object: {"reply": string, "confidence": number between 0 and 1, "needsHuman": boolean, "reason": string}.',
  ].join(" ");

  const userPrompt = [
    formatContextBlock(ctx, settings.aiContextWindow),
    "",
    "LATEST CUSTOMER MESSAGE:",
    ctx.inbound.body,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

async function pickAssignee(
  organizationId: string,
  preferredId: string | null,
): Promise<string | null> {
  const employees = await prisma.user.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (employees.length === 0) return null;
  if (preferredId && employees.some((row) => row.id === preferredId)) {
    return preferredId;
  }

  const lastAssigned = await prisma.customerConversation.findFirst({
    where: { organizationId, assignedEmployeeId: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { assignedEmployeeId: true },
  });
  const ids = employees.map((row) => row.id);
  const lastIndex = lastAssigned?.assignedEmployeeId
    ? ids.indexOf(lastAssigned.assignedEmployeeId)
    : -1;
  return ids[(lastIndex + 1) % ids.length] ?? ids[0] ?? null;
}

async function escalate(input: {
  organizationId: string;
  ctx: CustomerReplyContext;
  reason: string;
  confidence: number | null;
  draftReply: string | null;
  inboundMessageId: string;
  urgent: boolean;
}): Promise<ProcessCustomerAiReplyResult> {
  const assignedEmployeeId = await pickAssignee(
    input.organizationId,
    input.ctx.customer.assignedEmployeeId ?? input.ctx.conversation.assignedEmployeeId,
  );

  await prisma.customerConversation.updateMany({
    where: { id: input.ctx.conversation.id, organizationId: input.organizationId },
    data: {
      status: "HUMAN_ESCALATION",
      assignedEmployeeId,
      escalationReason: input.reason.slice(0, 500),
      priority: input.urgent ? "URGENT" : "HIGH",
    },
  });

  if (assignedEmployeeId && !input.ctx.customer.assignedEmployeeId) {
    await prisma.customer.updateMany({
      where: { id: input.ctx.customer.id, organizationId: input.organizationId },
      data: { assignedEmployeeId },
    });
  }

  const title = "Customer conversation needs a human";
  const body = `${input.ctx.customer.name}: ${input.ctx.inbound.body.slice(0, 140)}`;

  if (assignedEmployeeId) {
    await deliverNotifications({
      organizationId: input.organizationId,
      recipientIds: [assignedEmployeeId],
      title,
      body,
      type: "HUMAN_ESCALATION",
      linkHref: `/conversations?id=${input.ctx.conversation.id}`,
      category: "emailAlerts",
    });
  }

  await writeAuditLog({
    organizationId: input.organizationId,
    action: "customer_ai.escalated",
    entityType: "CustomerConversation",
    entityId: input.ctx.conversation.id,
    metadata: {
      decision: "escalated",
      reason: input.reason,
      confidence: input.confidence,
      inboundMessageId: input.inboundMessageId,
      assignedEmployeeId,
      draftReply: input.draftReply,
    },
  });

  return {
    decision: "escalated",
    organizationId: input.organizationId,
    conversationId: input.ctx.conversation.id,
    reason: input.reason,
    confidence: input.confidence,
    assignedEmployeeId,
    sent: false,
  };
}

/**
 * Background job body for an inbound customer message.
 * organizationId is taken from the Inngest event (set by the webhook after
 * inbox lookup) and re-checked on every query.
 */
export async function processCustomerAiReply(
  event: CustomerMessageAiEventData,
  deps: Partial<AiReplyDeps> = {},
): Promise<ProcessCustomerAiReplyResult> {
  const organizationId = event.organizationId;
  if (!organizationId) {
    throw new Error("processCustomerAiReply requires organizationId");
  }

  const retrieve = deps.retrieveContext ?? retrieveCustomerReplyContext;
  const completeJson = deps.completeJson ?? completeDeepSeekJson;
  const sendOutbound = deps.sendOutbound ?? defaultSendOutbound;
  const loadSettings = deps.loadSettings ?? defaultLoadSettings;

  const ctx = await retrieve(
    organizationId,
    event.customerId,
    event.conversationId,
    event.messageId,
  );

  if (ctx.organizationId !== organizationId) {
    throw new Error("Context organization mismatch");
  }

  const terminal = ["CLOSED", "RESOLVED", "HUMAN_ESCALATION"];
  if (terminal.includes(ctx.conversation.status)) {
    return {
      decision: "skipped",
      organizationId,
      conversationId: ctx.conversation.id,
      reason: `already_${ctx.conversation.status.toLowerCase()}`,
      confidence: null,
      assignedEmployeeId: ctx.conversation.assignedEmployeeId,
      sent: false,
    };
  }

  const alreadyReplied = ctx.priorMessages.some(
    (message) =>
      message.sender === "AI" && message.createdAt >= ctx.inbound.createdAt,
  );
  if (alreadyReplied) {
    return {
      decision: "skipped",
      organizationId,
      conversationId: ctx.conversation.id,
      reason: "already_replied",
      confidence: null,
      assignedEmployeeId: ctx.conversation.assignedEmployeeId,
      sent: false,
    };
  }

  const settings = await loadSettings(organizationId);
  const groundingSufficient = isGroundingSufficient(ctx);
  const prompts = buildDraftPrompts(ctx, settings);

  const raw = await completeJson({
    model: settings.aiModel,
    temperature: settings.aiTemperature,
    maxTokens: settings.aiMaxTokens,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
  });
  const draft = parseDraftReply(raw);

  const decision = shouldAutoReply({
    settings,
    draft,
    groundingSufficient,
    inboundBody: ctx.inbound.body,
  });

  if (!decision.reply) {
    return escalate({
      organizationId,
      ctx,
      reason: `${decision.reason}: ${draft.reason}`,
      confidence: draft.confidence,
      draftReply: draft.reply || null,
      inboundMessageId: event.messageId,
      urgent: draft.confidence < settings.escalationThreshold,
    });
  }

  const created = await prisma.customerMessage.create({
    data: {
      organizationId,
      conversationId: ctx.conversation.id,
      sender: "AI",
      body: draft.reply,
      confidenceScore: draft.confidence,
    },
    select: { id: true },
  });

  await prisma.customerConversation.updateMany({
    where: { id: ctx.conversation.id, organizationId },
    data: {
      status: "AI_HANDLING",
      lastMessageAt: new Date(),
      lastMessagePreview: draft.reply.slice(0, 180),
    },
  });

  const inbox = await prisma.messagingInbox.findFirst({
    where: {
      organizationId,
      provider: ctx.conversation.channel === "EMAIL" ? "EMAIL" : "WHATSAPP",
    },
    select: { externalAddress: true },
  });
  const contact =
    ctx.customer.whatsapp || ctx.customer.phone || ctx.customer.email;
  if (!inbox || !contact) {
    await writeAuditLog({
      organizationId,
      action: "customer_ai.replied_unsent",
      entityType: "CustomerConversation",
      entityId: ctx.conversation.id,
      metadata: {
        decision: "replied",
        reason: "missing_inbox_or_contact",
        confidence: draft.confidence,
        messageId: created.id,
      },
    });
  } else {
    await sendOutbound(ctx.conversation.channel, {
      inboxIdentifier: inbox.externalAddress,
      contactIdentifier: contact,
      body: draft.reply,
    });
  }

  await writeAuditLog({
    organizationId,
    action: "customer_ai.replied",
    entityType: "CustomerConversation",
    entityId: ctx.conversation.id,
    metadata: {
      decision: "replied",
      reason: decision.reason,
      modelReason: draft.reason,
      confidence: draft.confidence,
      inboundMessageId: event.messageId,
      aiMessageId: created.id,
      groundingSufficient,
    },
  });

  await publishToChannel(
    orgChannel(organizationId, "messages"),
    REALTIME_EVENTS.messageCreated,
    {
      conversationId: ctx.conversation.id,
      messageId: created.id,
      sender: "AI",
    },
  );

  return {
    decision: "replied",
    organizationId,
    conversationId: ctx.conversation.id,
    reason: decision.reason,
    confidence: draft.confidence,
    assignedEmployeeId: ctx.conversation.assignedEmployeeId,
    sent: Boolean(inbox && contact),
  };
}
