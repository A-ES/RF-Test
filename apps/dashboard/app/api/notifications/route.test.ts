import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const notifications = [
    {
      id: "n1",
      organizationId: "org_a",
      userId: "usr_a",
      title: "New AI insight ready",
      body: "Q3 pipeline analysis is complete.",
      read: false,
      createdAt: new Date("2026-09-19T09:00:00Z"),
    },
    {
      id: "n2",
      organizationId: "org_a",
      userId: "usr_b",
      title: "Someone else",
      body: "Should not be returned.",
      read: false,
      createdAt: new Date("2026-09-19T08:00:00Z"),
    },
  ];

  const findMany = vi.fn(async (args: { where?: { organizationId?: string; userId?: string } }) => {
    const { organizationId, userId } = args?.where ?? {};
    if (!organizationId || !userId) throw new Error("[tenant-guard] notification.findMany missing scope");
    return notifications.filter((n) => n.organizationId === organizationId && n.userId === userId);
  });

  const count = vi.fn(async (args: { where?: { organizationId?: string; userId?: string; read?: boolean } }) => {
    const { organizationId, userId } = args?.where ?? {};
    if (!organizationId || !userId) throw new Error("[tenant-guard] notification.count missing scope");
    return notifications.filter(
      (n) => n.organizationId === organizationId && n.userId === userId && n.read === args.where?.read,
    ).length;
  });

  const updateMany = vi.fn(async (args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if (!where.organizationId || !where.userId) throw new Error("[tenant-guard] notification.updateMany missing scope");
    return { count: 1 };
  });

  const getSession = vi.fn();
  return {
    getSession,
    prisma: { notification: { findMany, count, updateMany } },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));

import { GET, PATCH } from "./route";
import type { Session } from "@/app/lib/session";

function sessionFor(userId: string, organizationId: string): Session {
  return {
          mode: "CLIENT",
    userId,
    organizationId,
    name: "Test",
    email: "test@example.com",
    role: "MEMBER",
  };
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/notifications", () => {
  it("returns only the signed-in user's notifications", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { notifications: Array<{ id: string }>; unreadCount: number };
    expect(data.notifications.map((n) => n.id)).toEqual(["n1"]);
    expect(data.unreadCount).toBe(1);
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/notifications", () => {
  it("marks the caller's notifications as read", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    const res = await PATCH(patchRequest({ ids: ["n1"] }));
    expect(res.status).toBe(200);
    expect(h.prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_a",
          userId: "usr_a",
          id: { in: ["n1"] },
        }),
        data: { read: true },
      }),
    );
  });

  it("supports marking all as read", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    const res = await PATCH(patchRequest({ all: true }));
    expect(res.status).toBe(200);
    expect(h.prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ id: expect.anything() }),
      }),
    );
  });

  it("rejects an empty selection", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    const res = await PATCH(patchRequest({}));
    expect(res.status).toBe(400);
    expect(h.prisma.notification.updateMany).not.toHaveBeenCalled();
  });
});
