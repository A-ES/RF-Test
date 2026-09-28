import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/app/lib/session";

const h = vi.hoisted(() => {
  // Two admins so the last-admin guard fires only when we reduce to one.
  const members = [
    { id: "usr_admin1", name: "Admin One", email: "admin1@acme.com", role: "ADMIN", organizationId: "org_a" },
    { id: "usr_admin2", name: "Admin Two", email: "admin2@acme.com", role: "ADMIN", organizationId: "org_a" },
    { id: "usr_member", name: "Member",    email: "member@acme.com",  role: "MEMBER", organizationId: "org_a" },
  ];

  const findFirst = vi.fn(async (args: { where: { id: string; organizationId: string } }) =>
    members.find(
      (m) => m.id === args.where.id && m.organizationId === args.where.organizationId,
    ) ?? null,
  );

  const count = vi.fn(
    async (args: { where: { organizationId: string; role: string } }) =>
      members.filter(
        (m) => m.organizationId === args.where.organizationId && m.role === args.where.role,
      ).length,
  );

  const update = vi.fn(
    async (args: { where: { id: string }; data: { role: string } }) => {
      const m = members.find((u) => u.id === args.where.id)!;
      return { ...m, role: args.data.role, updatedAt: new Date() };
    },
  );

  const del = vi.fn(async () => ({}));
  const auditCreate = vi.fn(async () => ({}));

  const getSession = vi.fn<() => Promise<Session | null>>();

  return { members, findFirst, count, update, del, auditCreate, getSession,
    prisma: {
      user: { findFirst, count, update, delete: del },
      auditLog: { create: auditCreate },
    },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));

import { PATCH, DELETE } from "./route";

function adminSession(userId = "usr_admin1"): Session {
  return { mode: "CLIENT", userId, organizationId: "org_a", name: "Admin", email: "admin1@acme.com", role: "ADMIN" };
}
function memberSession(): Session {
  return { mode: "CLIENT", userId: "usr_member", organizationId: "org_a", name: "Member", email: "member@acme.com", role: "MEMBER" };
}

type Params = { params: Promise<{ id: string }> };

function ctx(id: string): Params {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/organization/members/usr_member", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

// ─── PATCH (role change) ──────────────────────────────────────────────────────

describe("PATCH /api/organization/members/[id]", () => {
  it("promotes a member to Admin", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(patchRequest({ role: "ADMIN" }), ctx("usr_member"));
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: "ADMIN" } }),
    );
    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "MEMBER_ROLE_CHANGED" }),
      }),
    );
  });

  it("demotes an Admin when another Admin exists", async () => {
    h.getSession.mockResolvedValue(adminSession("usr_admin1"));
    const res = await PATCH(patchRequest({ role: "MEMBER" }), ctx("usr_admin2"));
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: "MEMBER" } }),
    );
  });

  it("blocks demoting the last Admin (422)", async () => {
    // Patch count to return 1 Admin.
    h.count.mockResolvedValueOnce(1);
    h.getSession.mockResolvedValue(adminSession("usr_admin1"));
    const res = await PATCH(patchRequest({ role: "MEMBER" }), ctx("usr_admin1"));
    expect(res.status).toBe(422);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 409 when the member already has the requested role", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(patchRequest({ role: "MEMBER" }), ctx("usr_member"));
    expect(res.status).toBe(409);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid role", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(patchRequest({ role: "MANAGER" }), ctx("usr_member"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown member", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(patchRequest({ role: "ADMIN" }), ctx("usr_ghost"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-Admin caller", async () => {
    h.getSession.mockResolvedValue(memberSession());
    const res = await PATCH(patchRequest({ role: "ADMIN" }), ctx("usr_member"));
    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ role: "ADMIN" }), ctx("usr_member"));
    expect(res.status).toBe(401);
  });
});

// ─── DELETE (remove member) ───────────────────────────────────────────────────

describe("DELETE /api/organization/members/[id]", () => {
  it("removes a member", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await DELETE(
      new Request("http://localhost/api/organization/members/usr_member", { method: "DELETE" }),
      ctx("usr_member"),
    );
    expect(res.status).toBe(200);
    expect(h.del).toHaveBeenCalledWith({ where: { id: "usr_member" } });
    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "MEMBER_REMOVED" }),
      }),
    );
  });

  it("blocks self-removal (422)", async () => {
    h.getSession.mockResolvedValue(adminSession("usr_admin1"));
    const res = await DELETE(
      new Request("http://localhost/api/organization/members/usr_admin1", { method: "DELETE" }),
      ctx("usr_admin1"),
    );
    expect(res.status).toBe(422);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("blocks removing the last Admin (422)", async () => {
    h.count.mockResolvedValueOnce(1);
    h.getSession.mockResolvedValue(adminSession("usr_admin2"));
    const res = await DELETE(
      new Request("http://localhost/api/organization/members/usr_admin1", { method: "DELETE" }),
      ctx("usr_admin1"),
    );
    expect(res.status).toBe(422);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown member", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await DELETE(
      new Request("http://localhost/api/organization/members/usr_ghost", { method: "DELETE" }),
      ctx("usr_ghost"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-Admin", async () => {
    h.getSession.mockResolvedValue(memberSession());
    const res = await DELETE(
      new Request("http://localhost/api/organization/members/usr_admin1", { method: "DELETE" }),
      ctx("usr_admin1"),
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await DELETE(
      new Request("http://localhost/api/organization/members/usr_admin1", { method: "DELETE" }),
      ctx("usr_admin1"),
    );
    expect(res.status).toBe(401);
  });
});
