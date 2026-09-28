import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/app/lib/rate-limit";
import { signWhatsAppBody } from "@/app/lib/messaging/whatsapp";
import { CUSTOMER_MESSAGE_AI_EVENT } from "@/app/lib/inngest/client";

interface InboxRow {
  organizationId: string;
  provider: "WHATSAPP" | "EMAIL";
  externalAddress: string;
}

interface CustomerRow {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  lastInteractionAt: Date | null;
}

interface ConversationRow {
  id: string;
  organizationId: string;
  customerId: string;
  channel: string;
  status: string;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
}

interface MessageRow {
  id: string;
  organizationId: string;
  conversationId: string;
  sender: string;
  body: string;
  providerMessageId: string | null;
}

const APP_SECRET = "test-whatsapp-secret";

const h = vi.hoisted(() => {
  const inboxes: InboxRow[] = [];
  const customers: CustomerRow[] = [];
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${++seq}`;

  const requireOrg = (organizationId: unknown, model: string) => {
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      throw new Error(`[tenant-guard] ${model} missing organizationId`);
    }
    return organizationId;
  };

  const send = vi.fn(async () => undefined);

  const prisma = {
    messagingInbox: {
      findUnique: vi.fn(
        async (args: {
          where: {
            provider_externalAddress: {
              provider: "WHATSAPP" | "EMAIL";
              externalAddress: string;
            };
          };
        }) => {
          const key = args.where.provider_externalAddress;
          const row = inboxes.find(
            (inbox) =>
              inbox.provider === key.provider &&
              inbox.externalAddress === key.externalAddress,
          );
          return row ? { organizationId: row.organizationId } : null;
        },
      ),
    },
    customer: {
      findFirst: vi.fn(
        async (args: {
          where?: {
            organizationId?: string;
            whatsapp?: string;
            OR?: Array<{ whatsapp?: string; phone?: string }>;
          };
        }) => {
          const organizationId = requireOrg(
            args.where?.organizationId,
            "customer.findFirst",
          );
          const row = customers.find((customer) => {
            if (customer.organizationId !== organizationId) return false;
            if (args.where?.whatsapp) {
              return customer.whatsapp === args.where.whatsapp;
            }
            const or = args.where?.OR;
            if (!or) return false;
            return or.some(
              (clause) =>
                (clause.whatsapp && customer.whatsapp === clause.whatsapp) ||
                (clause.phone && customer.phone === clause.phone),
            );
          });
          return row ? { id: row.id } : null;
        },
      ),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const organizationId = requireOrg(
          args.data.organizationId,
          "customer.create",
        );
        const row: CustomerRow = {
          id: nextId("cus"),
          organizationId,
          name: String(args.data.name),
          phone: (args.data.phone as string | null) ?? null,
          whatsapp: (args.data.whatsapp as string | null) ?? null,
          lastInteractionAt: (args.data.lastInteractionAt as Date) ?? null,
        };
        customers.push(row);
        return { id: row.id };
      }),
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: { lastInteractionAt: Date };
        }) => {
          const row = customers.find((customer) => customer.id === args.where.id);
          if (!row) throw new Error("customer not found");
          row.lastInteractionAt = args.data.lastInteractionAt;
          return row;
        },
      ),
    },
    customerConversation: {
      findFirst: vi.fn(
        async (args: {
          where?: {
            organizationId?: string;
            customerId?: string;
            channel?: string;
            status?: { notIn?: string[] };
          };
        }) => {
          const organizationId = requireOrg(
            args.where?.organizationId,
            "customerConversation.findFirst",
          );
          const notIn = args.where?.status?.notIn ?? [];
          const matches = conversations.filter((conversation) => {
            if (conversation.organizationId !== organizationId) return false;
            if (
              args.where?.customerId &&
              conversation.customerId !== args.where.customerId
            ) {
              return false;
            }
            if (args.where?.channel && conversation.channel !== args.where.channel) {
              return false;
            }
            if (notIn.includes(conversation.status)) return false;
            return true;
          });
          matches.sort(
            (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
          );
          return matches[0] ?? null;
        },
      ),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const organizationId = requireOrg(
          args.data.organizationId,
          "customerConversation.create",
        );
        const row: ConversationRow = {
          id: nextId("cusconv"),
          organizationId,
          customerId: String(args.data.customerId),
          channel: String(args.data.channel),
          status: String(args.data.status ?? "OPEN"),
          lastMessageAt: (args.data.lastMessageAt as Date) ?? new Date(),
          lastMessagePreview: (args.data.lastMessagePreview as string) ?? null,
        };
        conversations.push(row);
        return row;
      }),
      update: vi.fn(
        async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = conversations.find(
            (conversation) => conversation.id === args.where.id,
          );
          if (!row) throw new Error("conversation not found");
          if (args.data.lastMessageAt) {
            row.lastMessageAt = args.data.lastMessageAt as Date;
          }
          if (typeof args.data.lastMessagePreview === "string") {
            row.lastMessagePreview = args.data.lastMessagePreview;
          }
          if (typeof args.data.status === "string") {
            row.status = args.data.status;
          }
          return row;
        },
      ),
    },
    customerMessage: {
      findFirst: vi.fn(
        async (args: {
          where?: { organizationId?: string; providerMessageId?: string };
        }) => {
          const organizationId = requireOrg(
            args.where?.organizationId,
            "customerMessage.findFirst",
          );
          const row = messages.find(
            (message) =>
              message.organizationId === organizationId &&
              message.providerMessageId === args.where?.providerMessageId,
          );
          if (!row) return null;
          const conversation = conversations.find(
            (item) => item.id === row.conversationId,
          );
          return {
            id: row.id,
            conversationId: row.conversationId,
            conversation: { customerId: conversation?.customerId ?? "" },
          };
        },
      ),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const organizationId = requireOrg(
          args.data.organizationId,
          "customerMessage.create",
        );
        const row: MessageRow = {
          id: nextId("cusmsg"),
          organizationId,
          conversationId: String(args.data.conversationId),
          sender: String(args.data.sender),
          body: String(args.data.body),
          providerMessageId: (args.data.providerMessageId as string | null) ?? null,
        };
        messages.push(row);
        return { id: row.id };
      }),
    },
  };

  return {
    inboxes,
    customers,
    conversations,
    messages,
    send,
    prisma,
    reset() {
      inboxes.length = 0;
      customers.length = 0;
      conversations.length = 0;
      messages.length = 0;
      seq = 0;
      inboxes.push(
        {
          organizationId: "org_acme",
          provider: "WHATSAPP",
          externalAddress: "pnid_acme",
        },
        {
          organizationId: "org_globex",
          provider: "WHATSAPP",
          externalAddress: "pnid_globex",
        },
      );
    },
  };
});

vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/inngest/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/inngest/client")>();
  return {
    ...actual,
    inngest: { send: h.send },
  };
});

import { GET, POST } from "./route";

function whatsappPayload(opts: {
  phoneNumberId: string;
  from: string;
  body: string;
  messageId: string;
  name: string;
}): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001000",
                phone_number_id: opts.phoneNumberId,
              },
              contacts: [
                { profile: { name: opts.name }, wa_id: opts.from },
              ],
              messages: [
                {
                  from: opts.from,
                  id: opts.messageId,
                  timestamp: "1759038000",
                  type: "text",
                  text: { body: opts.body },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function postWebhook(body: string): Request {
  return new Request("http://localhost/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": signWhatsAppBody(body, APP_SECRET),
    },
    body,
  });
}

beforeAll(() => {
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimit();
  h.reset();
});

describe("GET /api/webhooks/whatsapp", () => {
  it("echoes hub.challenge when the verify token matches", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123",
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");
  });
});

describe("POST /api/webhooks/whatsapp", () => {
  it("routes two inbound webhooks into the organization that owns each phone_number_id", async () => {
    const acmeBody = whatsappPayload({
      phoneNumberId: "pnid_acme",
      from: "15551110001",
      body: "Need a quote for 40 units",
      messageId: "wamid.acme.1",
      name: "Alice Acme",
    });
    const globexBody = whatsappPayload({
      phoneNumberId: "pnid_globex",
      from: "15552220002",
      body: "Is the shipment still on for Friday?",
      messageId: "wamid.globex.1",
      name: "Bob Globex",
    });

    const acmeRes = await POST(postWebhook(acmeBody));
    const globexRes = await POST(postWebhook(globexBody));

    expect(acmeRes.status).toBe(200);
    expect(globexRes.status).toBe(200);

    const acmeCustomers = h.customers.filter((row) => row.organizationId === "org_acme");
    const globexCustomers = h.customers.filter(
      (row) => row.organizationId === "org_globex",
    );

    expect(acmeCustomers).toHaveLength(1);
    expect(globexCustomers).toHaveLength(1);
    expect(acmeCustomers[0]?.whatsapp).toBe("+15551110001");
    expect(globexCustomers[0]?.whatsapp).toBe("+15552220002");
    expect(acmeCustomers.map((row) => row.whatsapp)).not.toContain("+15552220002");
    expect(globexCustomers.map((row) => row.whatsapp)).not.toContain("+15551110001");

    const acmeMessages = h.messages.filter((row) => row.organizationId === "org_acme");
    const globexMessages = h.messages.filter(
      (row) => row.organizationId === "org_globex",
    );

    expect(acmeMessages).toHaveLength(1);
    expect(globexMessages).toHaveLength(1);
    expect(acmeMessages[0]?.body).toBe("Need a quote for 40 units");
    expect(acmeMessages[0]?.sender).toBe("CUSTOMER");
    expect(globexMessages[0]?.body).toBe("Is the shipment still on for Friday?");
    expect(globexMessages[0]?.sender).toBe("CUSTOMER");

    const acmeConversation = h.conversations.find(
      (row) => row.id === acmeMessages[0]?.conversationId,
    );
    const globexConversation = h.conversations.find(
      (row) => row.id === globexMessages[0]?.conversationId,
    );
    expect(acmeConversation?.organizationId).toBe("org_acme");
    expect(acmeConversation?.customerId).toBe(acmeCustomers[0]?.id);
    expect(globexConversation?.organizationId).toBe("org_globex");
    expect(globexConversation?.customerId).toBe(globexCustomers[0]?.id);

    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send).toHaveBeenNthCalledWith(1, {
      name: CUSTOMER_MESSAGE_AI_EVENT,
      data: expect.objectContaining({
        organizationId: "org_acme",
        customerId: acmeCustomers[0]?.id,
        conversationId: acmeConversation?.id,
        messageId: acmeMessages[0]?.id,
      }),
    });
    expect(h.send).toHaveBeenNthCalledWith(2, {
      name: CUSTOMER_MESSAGE_AI_EVENT,
      data: expect.objectContaining({
        organizationId: "org_globex",
        customerId: globexCustomers[0]?.id,
        conversationId: globexConversation?.id,
        messageId: globexMessages[0]?.id,
      }),
    });
  });

  it("rejects an unsigned payload", async () => {
    const body = whatsappPayload({
      phoneNumberId: "pnid_acme",
      from: "15551110001",
      body: "hello",
      messageId: "wamid.unsigned",
      name: "Alice",
    });
    const res = await POST(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
    expect(res.status).toBe(401);
    expect(h.messages).toHaveLength(0);
    expect(h.send).not.toHaveBeenCalled();
  });
});
