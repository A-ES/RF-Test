import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const conversations: Record<string, string> = { int_a: "org_a", int_b: "org_b" };
  const findFirst = vi.fn(async (args: { where?: { id?: string; organizationId?: string } }) => {
    const { id, organizationId } = args?.where ?? {};
    if (!id || conversations[id] !== organizationId) return null;
    return { id };
  });
  const update = vi.fn(async (args: { data: { unread: boolean } }) => ({
    id: "int_a",
    unread: args.data.unread,
  }));
  const getSession = vi.fn();
  return { findFirst, update, getSession, prisma: { conversation: { findFirst, update } } };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));

import { PATCH } from "./route";
import type { Session } from "@/app/lib/session";

function sessionFor(organizationId: string): Session {
  return { mode: "CLIENT", userId: "usr_a", organizationId, name: "Test", email: "t@example.com", role: "MEMBER" };
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/conversations/int_a", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/conversations/[id]", () => {
  it("marks a conversation as read within the caller's organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await PATCH(patchRequest({ unread: false }), ctx("int_a"));
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "int_a" }, data: { unread: false } }),
    );
  });

  it("returns 404 for another organization's conversation", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await PATCH(patchRequest({ unread: false }), ctx("int_b"));
    expect(res.status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ unread: false }), ctx("int_a"));
    expect(res.status).toBe(401);
  });
});
