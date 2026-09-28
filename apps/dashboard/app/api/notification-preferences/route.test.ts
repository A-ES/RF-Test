import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/app/lib/session";

const h = vi.hoisted(() => {
  const pref = {
    id: "pref_1",
    userId: "usr_a",
    organizationId: "org_a",
    emailEnabled: true,
    inAppEnabled: true,
    emailAlerts: true,
    riskSignals: true,
    weeklyDigest: true,
    slackIntegration: false,
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const findUnique = vi.fn(async (args: { where: { userId: string } }) =>
    args.where.userId === "usr_a" ? { ...pref } : null,
  );

  const upsert = vi.fn(
    async (args: { where: { userId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => ({
      ...pref,
      ...args.update,
      updatedAt: new Date(),
    }),
  );

  const getSession = vi.fn<() => Promise<Session | null>>();

  return {
    pref,
    findUnique,
    upsert,
    getSession,
    prisma: { notificationPreference: { findUnique, upsert } },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));

import { GET, PATCH } from "./route";

function session(userId = "usr_a"): Session {
  return { mode: "CLIENT", userId, organizationId: "org_a", name: "Test", email: "test@acme.com", role: "MEMBER" };
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/notification-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/notification-preferences", () => {
  it("returns the user's preferences when a row exists", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { preferences: { id: string; emailEnabled: boolean } };
    expect(data.preferences.id).toBe("pref_1");
    expect(data.preferences.emailEnabled).toBe(true);
  });

  it("returns defaults (id: null) when no row exists", async () => {
    h.getSession.mockResolvedValue(session("usr_new"));
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { preferences: { id: null; emailEnabled: boolean } };
    expect(data.preferences.id).toBeNull();
    expect(data.preferences.emailEnabled).toBe(true);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/notification-preferences", () => {
  it("upserts a single boolean field", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({ emailAlerts: false }));
    expect(res.status).toBe(200);
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "usr_a" },
        update: { emailAlerts: false },
      }),
    );
  });

  it("upserts multiple fields in one call", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(
      patchRequest({ riskSignals: false, slackIntegration: true }),
    );
    expect(res.status).toBe(200);
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { riskSignals: false, slackIntegration: true },
      }),
    );
  });

  it("ignores unknown fields", async () => {
    h.getSession.mockResolvedValue(session());
    await PATCH(patchRequest({ emailAlerts: true, unknownField: "x" }));
    const call = h.upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(call.update).not.toHaveProperty("unknownField");
  });

  it("returns 400 when no valid fields are provided", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({ unknownField: true }));
    expect(res.status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for non-boolean values", async () => {
    h.getSession.mockResolvedValue(session());
    const res = await PATCH(patchRequest({ emailAlerts: "yes" }));
    expect(res.status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ emailAlerts: false }));
    expect(res.status).toBe(401);
  });
});
