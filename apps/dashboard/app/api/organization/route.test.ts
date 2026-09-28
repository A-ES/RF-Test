import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/app/lib/session";

// ─── hoisted mocks ───────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const org = {
    id: "org_a",
    name: "Acme Corp",
    plan: "Enterprise",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const findUnique = vi.fn(async (args: { where: { id: string } }) => {
    if (args.where.id === "org_a") return { ...org };
    return null;
  });

  const update = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
    ...org,
    ...args.data,
    updatedAt: new Date("2025-06-01T00:00:00Z"),
  }));

  const auditCreate = vi.fn(async () => ({}));

  const getSession = vi.fn<() => Promise<Session | null>>();

  return {
    org,
    findUnique,
    update,
    auditCreate,
    getSession,
    prisma: {
      organization: { findUnique, update },
      auditLog: { create: auditCreate },
    },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));

import { GET, PATCH } from "./route";

function adminSession(): Session {
  return {
          mode: "CLIENT",
    userId: "usr_admin",
    organizationId: "org_a",
    name: "Admin User",
    email: "admin@acme.com",
    role: "ADMIN",
  };
}

function memberSession(): Session {
  return {
          mode: "CLIENT",
    userId: "usr_member",
    organizationId: "org_a",
    name: "Member User",
    email: "member@acme.com",
    role: "MEMBER",
  };
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/organization", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/organization", () => {
  it("returns the organization for any authenticated user", async () => {
    h.getSession.mockResolvedValue(memberSession());
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { organization: { id: string; name: string } };
    expect(data.organization.id).toBe("org_a");
    expect(data.organization.name).toBe("Acme Corp");
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ─── PATCH ───────────────────────────────────────────────────────────────────

describe("PATCH /api/organization", () => {
  it("updates org name when called by an Admin", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(patchRequest({ name: "New Name" }));
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_a" },
        data: expect.objectContaining({ name: "New Name" }),
      }),
    );
    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ORGANIZATION_UPDATED" }),
      }),
    );
  });

  it("updates plan when called by an Admin", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(patchRequest({ plan: "Pro" }));
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan: "Pro" }),
      }),
    );
  });

  it("returns 403 for a non-Admin", async () => {
    h.getSession.mockResolvedValue(memberSession());
    const res = await PATCH(patchRequest({ name: "Hacked" }));
    expect(res.status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ name: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when no fields are provided", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(patchRequest({}));
    expect(res.status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty name", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(patchRequest({ name: "   " }));
    expect(res.status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await PATCH(
      new Request("http://localhost/api/organization", {
        method: "PATCH",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
