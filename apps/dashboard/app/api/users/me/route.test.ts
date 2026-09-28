import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/app/lib/session";

const h = vi.hoisted(() => {
  const user = {
    id: "usr_a",
    name: "Jordan Ellis",
    email: "jordan@acme.com",
    role: "ADMIN",
    avatarInitials: "JE",
    isRFTeam: false,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const findUnique = vi.fn(async (args: { where: { id: string } }) =>
    args.where.id === "usr_a" ? { ...user } : null,
  );

  const update = vi.fn(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
      ...user,
      ...args.data,
      updatedAt: new Date(),
    }),
  );

  const getSession = vi.fn<() => Promise<Session | null>>();

  return {
    user,
    findUnique,
    update,
    getSession,
    prisma: { user: { findUnique, update } },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));

import { GET, PATCH } from "./route";

function session(): Session {
  return {
          mode: "CLIENT",
    userId: "usr_a",
    organizationId: "org_a",
    name: "Jordan Ellis",
    email: "jordan@acme.com",
    role: "ADMIN",
  };
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/users/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/users/me", () => {
  it("returns the current user", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { id: string; name: string } };
    expect(data.user.id).toBe("usr_a");
    expect(data.user.name).toBe("Jordan Ellis");
    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "usr_a" } }),
    );
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/users/me", () => {
  it("updates name", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({ name: "Jordan E." }));
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "usr_a" },
        data: expect.objectContaining({ name: "Jordan E." }),
      }),
    );
  });

  it("updates email (lowercased)", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({ email: "JORDAN@ACME.COM" }));
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "jordan@acme.com" }),
      }),
    );
  });

  it("updates avatarInitials (uppercased)", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({ avatarInitials: "je" }));
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ avatarInitials: "JE" }),
      }),
    );
  });

  it("returns 400 when no fields are provided", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({}));
    expect(res.status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid email", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({ email: "notanemail" }));
    expect(res.status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 400 for bad avatarInitials", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({ avatarInitials: "1234" }));
    expect(res.status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("returns 409 on email uniqueness collision", async () => {
    h.getSession.mockResolvedValue(session());
    h.update.mockRejectedValueOnce({ code: "P2002" });
    const res = await PATCH(patchRequest({ email: "taken@acme.com" }));
    expect(res.status).toBe(409);
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ name: "x" }));
    expect(res.status).toBe(401);
  });
});
