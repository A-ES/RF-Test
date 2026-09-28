import { prisma } from "@/app/lib/db";
import type { RetrievedSource } from "@/app/lib/retrieval";

const PER_TYPE_LIMIT = 25;
const THREAD_LIMIT = 40;

export interface CustomerRecord {
  id: string;
  organizationId: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  status: string;
  tagsJson: string;
  internalNotes: string | null;
  orderReference: string | null;
  assignedEmployeeId: string | null;
}

export interface ConversationRecord {
  id: string;
  organizationId: string;
  customerId: string;
  channel: "WHATSAPP" | "EMAIL" | "WEB_CHAT" | "SMS";
  status: string;
  assignedEmployeeId: string | null;
}

export interface ThreadMessage {
  id: string;
  sender: string;
  body: string;
  createdAt: Date;
}

export interface CustomerReplyContext {
  organizationId: string;
  customer: CustomerRecord;
  conversation: ConversationRecord;
  inbound: ThreadMessage;
  priorMessages: ThreadMessage[];
  otherConversations: Array<{
    id: string;
    channel: string;
    subject: string | null;
    lastMessagePreview: string | null;
    status: string;
  }>;
  workspaceSources: RetrievedSource[];
}

function requireOrg(organizationId: string, label: string): string {
  if (!organizationId) {
    throw new Error(`${label} requires an organizationId`);
  }
  return organizationId;
}

function mentionsCustomer(
  haystack: string,
  customer: Pick<CustomerRecord, "name" | "company" | "email">,
): boolean {
  const text = haystack.toLowerCase();
  const needles = [customer.name, customer.company, customer.email]
    .filter((value): value is string => Boolean(value && value.trim().length > 1))
    .map((value) => value.toLowerCase());
  return needles.some((needle) => text.includes(needle));
}

/**
 * Context for drafting a customer reply.
 *
 * SECURITY: every Prisma query includes `organizationId`. Customer rows are
 * loaded with `{ id, organizationId }` so a forged customerId from another
 * tenant cannot leak. Workspace insights/projects/documents are org-scoped
 * and then kept only when they refer to this customer.
 */
export async function retrieveCustomerReplyContext(
  organizationId: string,
  customerId: string,
  conversationId: string,
  inboundMessageId: string,
): Promise<CustomerReplyContext> {
  const orgId = requireOrg(organizationId, "retrieveCustomerReplyContext");
  if (!customerId || !conversationId || !inboundMessageId) {
    throw new Error("retrieveCustomerReplyContext requires customer, conversation, and message ids");
  }

  const [customer, conversation] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        company: true,
        email: true,
        phone: true,
        whatsapp: true,
        status: true,
        tagsJson: true,
        internalNotes: true,
        orderReference: true,
        assignedEmployeeId: true,
      },
    }),
    prisma.customerConversation.findFirst({
      where: { id: conversationId, customerId, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        customerId: true,
        channel: true,
        status: true,
        assignedEmployeeId: true,
      },
    }),
  ]);

  if (!customer || !conversation) {
    throw new Error("Customer conversation not found in this organization");
  }

  const [thread, otherConversations, insights, projects, documents] = await Promise.all([
    prisma.customerMessage.findMany({
      where: { conversationId, organizationId: orgId },
      orderBy: { createdAt: "asc" },
      take: THREAD_LIMIT,
      select: { id: true, sender: true, body: true, createdAt: true },
    }),
    prisma.customerConversation.findMany({
      where: {
        organizationId: orgId,
        customerId,
        id: { not: conversationId },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 8,
      select: {
        id: true,
        channel: true,
        subject: true,
        lastMessagePreview: true,
        status: true,
      },
    }),
    prisma.insight.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: PER_TYPE_LIMIT,
      select: {
        id: true,
        title: true,
        body: true,
        accountName: true,
        whatHappened: true,
        recommendedAction: true,
        createdAt: true,
      },
    }),
    prisma.project.findMany({
      where: { organizationId: orgId },
      orderBy: { updatedAt: "desc" },
      take: PER_TYPE_LIMIT,
      select: {
        id: true,
        name: true,
        accountName: true,
        status: true,
        progress: true,
        createdAt: true,
      },
    }),
    prisma.document.findMany({
      where: { organizationId: orgId, processingStatus: "PROCESSED" },
      orderBy: { createdAt: "desc" },
      take: PER_TYPE_LIMIT,
      select: {
        id: true,
        fileName: true,
        linkedAccount: true,
        createdAt: true,
      },
    }),
  ]);

  const inbound = thread.find((message) => message.id === inboundMessageId);
  if (!inbound) {
    throw new Error("Inbound message not found in this organization");
  }

  const priorMessages = thread.filter((message) => message.id !== inboundMessageId);

  const workspaceSources: RetrievedSource[] = [];

  for (const insight of insights) {
    const blob = [insight.title, insight.body, insight.accountName, insight.whatHappened]
      .filter(Boolean)
      .join(" ");
    if (!mentionsCustomer(blob, customer)) continue;
    workspaceSources.push({
      id: insight.id,
      type: "insight",
      title: insight.title,
      summary: [insight.body, insight.whatHappened, insight.recommendedAction]
        .filter(Boolean)
        .join(". "),
      createdAt: insight.createdAt,
    });
  }

  for (const project of projects) {
    const blob = `${project.name} ${project.accountName}`;
    if (!mentionsCustomer(blob, customer)) continue;
    workspaceSources.push({
      id: project.id,
      type: "project",
      title: project.name,
      summary: `Project for ${project.accountName}. Status ${project.status}, ${project.progress}% complete.`,
      createdAt: project.createdAt,
    });
  }

  for (const document of documents) {
    const blob = `${document.fileName} ${document.linkedAccount ?? ""}`;
    if (!mentionsCustomer(blob, customer)) continue;
    workspaceSources.push({
      id: document.id,
      type: "document",
      title: document.fileName,
      summary: document.linkedAccount
        ? `Document linked to ${document.linkedAccount}`
        : "Uploaded document",
      createdAt: document.createdAt,
    });
  }

  return {
    organizationId: orgId,
    customer,
    conversation,
    inbound,
    priorMessages,
    otherConversations,
    workspaceSources,
  };
}

const FACT_SEEKING =
  /\b(order|sku|discount|price|quote|ship|shipment|delivery|invoice|refund|warranty|contract|arrangement|warehouse|stock|lead\s*time|po-|purchase|usual|last time|other sku|other team)\b/i;

export function messageRequiresGroundedFacts(body: string): boolean {
  return FACT_SEEKING.test(body);
}

export function isGroundingSufficient(ctx: CustomerReplyContext): boolean {
  const hasOrderHistory = Boolean(ctx.customer.orderReference?.trim());
  const hasNotes = Boolean(ctx.customer.internalNotes?.trim());
  const hasPriorThread =
    ctx.priorMessages.length > 0 || ctx.otherConversations.length > 0;
  const hasWorkspace = ctx.workspaceSources.length > 0;
  return hasOrderHistory || hasNotes || hasPriorThread || hasWorkspace;
}
