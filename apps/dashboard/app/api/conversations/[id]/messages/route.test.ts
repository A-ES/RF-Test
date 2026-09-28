import { beforeEach, describe, expect, it, vi } from "vitest";

interface MessageArgs {
  where?: { conversationId?: string; organizationId?: string };
  select?: { senderId?: boolean };
  include?: unknown;
}

const h = vi.hoisted(() => {
  const conversations: Record<string, { id: string; organizationId: string; topic: string }> = {
    int_a: { id: "int_a", organizationId: "org_a", topic: "Acme Renewal" },
    int_b: { id: "int_b", organizationId: "org_b", topic: "Other tenant" },
  };

  const conversationFindFirst = vi.fn(async (args: { where?: { id?: string; organizationId?: string } }) => {
    const { id, organizationId } = args?.where ?? {};
    const row = id ? conversations[id] : undefined;
    if (!row || row.organizationId !== organizationId) return null;
    return { id: row.id, topic: row.topic, contextLabel: "Account: Acme", rfLead: "RF", unread: true };
  });

  const messageFindMany = vi.fn(async (args: MessageArgs) => {
    if (args?.select?.senderId) {
      return [{ senderId: "usr_priya" }, { senderId: "usr_jordan" }];
    }
    return [
      {
        id: "msg_1",
        conversationId: "int_a",
        senderId: "usr_priya",
        isRFTeam: false,
        content: "Hello",
        createdAt: new Date("2026-09-19T09:00:00Z"),
        sender: { name: "Priya Sharma", avatarInitials: "PS", role: "MEMBER", isRFTeam: false },
      },
    ];
  });

  const messageCreate = vi.fn(async (args: { data: { organizationId: string; conversationId: string; senderId: string; isRFTeam: boolean; content: string } }) => ({
    id: "msg_new",
    conversationId: args.data.conversationId,
    senderId: args.data.senderId,
    isRFTeam: args.data.isRFTeam,
    content: args.data.content,
    createdAt: new Date("2026-09-19T10:00:00Z"),
    sender: { name: "Jordan Ellis", avatarInitials: "JE", role: "ADMIN", isRFTeam: args.data.isRFTeam },
  }));

  const conversationUpdate = vi.fn(async () => ({ id: "int_a", unread: true }));
  const userFindFirst = vi.fn(async () => ({ id: "usr_jordan", isRFTeam: false }));
  const userFindMany = vi.fn(async () => [{ id: "usr_rf_tech" }, { id: "usr_rf_data" }]);

  const getSession = vi.fn();
  const deliverNotifications = vi.fn(async () => [{ userId: "usr_priya", notificationId: "n1", emailed: true }]);
  const publishToChannel = vi.fn(async () => true);

  return {
    conversationFindFirst,
    messageFindMany,
    messageCreate,
    conversationUpdate,
    userFindFirst,
    userFindMany,
    getSession,
    deliverNotifications,
    publishToChannel,
    prisma: {
      conversation: { findFirst: conversationFindFirst, update: conversationUpdate },
      message: { findMany: messageFindMany, create: messageCreate },
      user: { findFirst: userFindFirst, findMany: userFindMany },
    },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/notifications", () => ({ deliverNotifications: h.deliverNotifications }));
vi.mock("@/app/lib/realtime/server", () => ({ publishToChannel: h.publishToChannel }));

import { GET, POST } from "./route";
import type { Session } from "@/app/lib/session";

function sessionFor(organizationId: string): Session {
  return {
          mode: "CLIENT",
    userId: "usr_jordan",
    organizationId,
    name: "Jordan Ellis",
    email: "jordan.ellis@acmecorp.com",
    role: "ADMIN",
  };
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/conversations/int_a/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/conversations/[id]/messages", () => {
  it("returns messages for a conversation in the caller's organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await GET(new Request("http://localhost/api/conversations/int_a/messages"), ctx("int_a"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { messages: Array<{ senderName: string; senderRole: string }> };
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0]?.senderName).toBe("Priya Sharma");
    expect(data.messages[0]?.senderRole).toBe("Member");
    expect(h.messageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId: "int_a", organizationId: "org_a" }),
      }),
    );
  });

  it("returns 404 for a conversation owned by another organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await GET(new Request("http://localhost/api/conversations/int_b/messages"), ctx("int_b"));
    expect(res.status).toBe(404);
    expect(h.messageFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/conversations/int_a/messages"), ctx("int_a"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/conversations/[id]/messages", () => {
  it("stores the message and notifies the RF team for a client-authored message", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(postRequest({ content: "Please review the deck" }), ctx("int_a"));
    expect(res.status).toBe(201);

    expect(h.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org_a",
          conversationId: "int_a",
          senderId: "usr_jordan",
          isRFTeam: false,
          content: "Please review the deck",
        }),
      }),
    );

    expect(h.deliverNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_a",
        recipientIds: expect.arrayContaining(["usr_priya", "usr_rf_tech", "usr_rf_data"]),
      }),
    );
    expect(h.publishToChannel).toHaveBeenCalled();
  });

  it("returns 404 for a conversation owned by another organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(postRequest({ content: "hi" }), ctx("int_b"));
    expect(res.status).toBe(404);
    expect(h.messageCreate).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(postRequest({ content: "   " }), ctx("int_a"));
    expect(res.status).toBe(400);
    expect(h.messageCreate).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await POST(postRequest({ content: "hi" }), ctx("int_a"));
    expect(res.status).toBe(401);
  });
});
