import { beforeEach, describe, expect, it, vi } from "vitest";

interface ConversationRow {
  id: string;
  organizationId: string;
  topic: string;
  contextLabel: string;
  rfLead: string;
  unread: boolean;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{ content: string; createdAt: Date }>;
  _count: { messages: number };
}

interface FindManyArgs {
  where?: { organizationId?: string };
  take?: number;
}

interface CreateArgs {
  data: {
    organizationId?: string;
    topic: string;
    contextLabel: string;
    rfLead: string;
  };
}

const h = vi.hoisted(() => {
  const conversations: ConversationRow[] = [
    {
      id: "int_a",
      organizationId: "org_a",
      topic: "Acme Renewal",
      contextLabel: "Account: Acme Corp",
      rfLead: "RF Intelligence Support",
      unread: true,
      createdAt: new Date("2026-09-19T09:00:00Z"),
      updatedAt: new Date("2026-09-19T09:05:00Z"),
      messages: [{ content: "Latest message", createdAt: new Date("2026-09-19T09:05:00Z") }],
      _count: { messages: 3 },
    },
    {
      id: "int_b",
      organizationId: "org_b",
      topic: "Other tenant",
      contextLabel: "Account: Redwood",
      rfLead: "RF Support",
      unread: false,
      createdAt: new Date("2026-09-18T09:00:00Z"),
      updatedAt: new Date("2026-09-18T09:00:00Z"),
      messages: [],
      _count: { messages: 0 },
    },
  ];

  const findMany = vi.fn(async (args: FindManyArgs) => {
    const organizationId = args?.where?.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      throw new Error("[tenant-guard] conversation.findMany missing organizationId");
    }
    return conversations
      .filter((row) => row.organizationId === organizationId)
      .slice(0, args.take ?? conversations.length);
  });

  const create = vi.fn(async (args: CreateArgs) => {
    const organizationId = args?.data?.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      throw new Error("[tenant-guard] conversation.create missing organizationId");
    }
    return {
      id: "int_new",
      organizationId,
      topic: args.data.topic,
      contextLabel: args.data.contextLabel,
      rfLead: args.data.rfLead,
      unread: false,
      createdAt: new Date("2026-09-19T10:00:00Z"),
      updatedAt: new Date("2026-09-19T10:00:00Z"),
    };
  });

  const getSession = vi.fn();
  const publishToChannel = vi.fn(async () => true);
  return {
    conversations,
    findMany,
    create,
    getSession,
    publishToChannel,
    prisma: { conversation: { findMany, create } },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/realtime/server", () => ({
  publishToChannel: h.publishToChannel,
}));

import { GET, POST } from "./route";
import type { Session } from "@/app/lib/session";

function sessionFor(organizationId: string): Session {
  return {
          mode: "CLIENT",
    userId: "usr_a",
    organizationId,
    name: "Test",
    email: "test@example.com",
    role: "MEMBER",
  };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/conversations", () => {
  it("returns only the caller's organization conversations", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await GET(new Request("http://localhost/api/conversations"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      conversations: Array<{ id: string; lastMessagePreview: string | null }>;
    };
    expect(data.conversations.map((c) => c.id)).toEqual(["int_a"]);
    expect(data.conversations[0]?.lastMessagePreview).toBe("Latest message");
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_a" }),
      }),
    );
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/conversations"));
    expect(res.status).toBe(401);
  });

  it("defaults the page size instead of clamping to a single row", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    await GET(new Request("http://localhost/api/conversations"));
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it("honours an explicit limit", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    await GET(new Request("http://localhost/api/conversations?limit=10"));
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });
});

describe("POST /api/conversations", () => {
  it("creates a conversation scoped to the session organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(
      postRequest({
        topic: "New escalation",
        contextLabel: "Account: Acme Corp",
        organizationId: "org_b",
      }),
    );
    expect(res.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org_a",
          topic: "New escalation",
          contextLabel: "Account: Acme Corp",
        }),
      }),
    );
    expect(h.publishToChannel).toHaveBeenCalled();
  });

  it("rejects a missing topic", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(postRequest({ contextLabel: "Account: Acme" }));
    expect(res.status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await POST(postRequest({ topic: "x", contextLabel: "y" }));
    expect(res.status).toBe(401);
  });
});
