import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/app/lib/session";

const h = vi.hoisted(() => {
  const pendingInvitation = {
    id: "inv_resend_1",
    organizationId: "org_a",
    invitedById: "usr_admin",
    email: "test.resend@example.com",
    role: "MEMBER" as const,
    jobTitle: "Security Engineer",
    token: "tok_old",
    status: "PENDING" as const,
    expiresAt: new Date(Date.now() + 86_400_000),
    organization: { name: "Acme Industrial" },
  };

  const invFindFirst = vi.fn(async (args: { where: { id: string } }) => {
    if (args.where.id === "inv_resend_1") return { ...pendingInvitation };
    return null;
  });
  const invUpdate = vi.fn(async () => ({ ...pendingInvitation }));
  const auditCreate = vi.fn(async () => ({}));
  const sendEmail = vi.fn<
    () => Promise<{ delivered: boolean; provider: string; providerMessageId?: string; error?: string }>
  >(async () => ({
    delivered: true,
    provider: "smtp",
    providerMessageId: "msg_smtp_999",
  }));
  const getSession = vi.fn<() => Promise<Session | null>>();

  return {
    pendingInvitation,
    invFindFirst,
    invUpdate,
    auditCreate,
    sendEmail,
    getSession,
    prisma: {
      invitation: { findFirst: invFindFirst, update: invUpdate },
      auditLog: { create: auditCreate },
    },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/email", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/app/lib/invite-token", () => ({
  createInviteToken: vi.fn(() => "new_signed_token"),
}));
vi.mock("@/app/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 14, retryAfterSeconds: 0 })),
}));

import { POST } from "./route";

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

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/organization/invitations/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/organization/invitations/resend", () => {
  it("refreshes token, extends expiry by 7 days, and resends email", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ id: "inv_resend_1" }));
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      invitation: { id: string; email: string };
      emailDelivery: { delivered: boolean; status: string };
    };
    expect(data.ok).toBe(true);
    expect(data.emailDelivery.delivered).toBe(true);
    expect(data.emailDelivery.status).toBe("DELIVERED");

    // Token updated
    expect(h.invUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv_resend_1" },
        data: expect.objectContaining({ token: "new_signed_token" }),
      }),
    );

    // Email dispatched
    expect(h.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "test.resend@example.com" }),
    );
  });

  it("returns 404 if pending invitation is not found", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ id: "non_existent_id" }));
    expect(res.status).toBe(404);
  });

  it("returns 502 with error details if provider rejects delivery", async () => {
    h.getSession.mockResolvedValue(adminSession());
    h.sendEmail.mockResolvedValueOnce({
      delivered: false,
      provider: "smtp",
      error: "SMTP not configured: SMTP_HOST is required",
    });

    const res = await POST(postRequest({ id: "inv_resend_1" }));
    expect(res.status).toBe(502);

    const data = (await res.json()) as { ok: boolean; error: string; emailDelivery: { delivered: boolean } };
    expect(data.ok).toBe(false);
    expect(data.emailDelivery.delivered).toBe(false);
    expect(data.error).toContain("SMTP not configured");
  });

  it("blocks non-admin users with 403", async () => {
    h.getSession.mockResolvedValue(memberSession());
    const res = await POST(postRequest({ id: "inv_resend_1" }));
    expect(res.status).toBe(403);
  });

  it("blocks unauthenticated users with 401", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await POST(postRequest({ id: "inv_resend_1" }));
    expect(res.status).toBe(401);
  });
});
