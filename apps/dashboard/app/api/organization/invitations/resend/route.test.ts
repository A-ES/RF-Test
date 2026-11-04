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
  const invCreate = vi.fn(async () => ({
    id: "inv_resend_2",
    organizationId: "org_a",
    invitedById: "usr_admin",
    email: "pending@acme.com",
    role: "MEMBER" as const,
    jobTitle: "Security Engineer",
    token: "tok_new",
    status: "PENDING" as const,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    organization: { name: "Acme Industrial" },
  }));
  const invUpdate = vi.fn(async () => ({ ...pendingInvitation }));
  const invUpdateMany = vi.fn(async () => ({ count: 1 }));
  const userFindFirst = vi.fn(async () => null);
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
    invCreate,
    invUpdate,
    invUpdateMany,
    userFindFirst,
    auditCreate,
    sendEmail,
    getSession,
    prisma: {
      invitation: {
        findFirst: invFindFirst,
        create: invCreate,
        update: invUpdate,
        updateMany: invUpdateMany,
      },
      user: { findFirst: userFindFirst },
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
  it("refreshes token, extends expiry by 7 days, and resends email (by ID)", async () => {
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

    expect(h.invUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv_resend_1" },
        data: expect.objectContaining({ token: "new_signed_token" }),
      }),
    );

    expect(h.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "test.resend@example.com" }),
    );
  });

  it("resends invitation for user with null passwordHash (by email)", async () => {
    h.getSession.mockResolvedValue(adminSession());
    h.userFindFirst.mockResolvedValueOnce({
      id: "usr_seed",
      passwordHash: null,
      role: "MEMBER",
      jobTitle: "Analyst",
    });

    const res = await POST(postRequest({ email: "seed@acme.com" }));
    expect(res.status).toBe(200);

    expect(h.invUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_a",
        email: "seed@acme.com",
        status: "PENDING",
      },
      data: { status: "REVOKED" },
    });

    expect(h.sendEmail).toHaveBeenCalled();
    expect(h.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "INVITATION_RESENT",
      }),
    });
  });

  it("returns 400 when user has already set password", async () => {
    h.getSession.mockResolvedValue(adminSession());
    h.userFindFirst.mockResolvedValueOnce({
      id: "usr_active",
      passwordHash: "scrypt$16384$8$1$salt$hash",
      role: "MEMBER",
      jobTitle: "Developer",
    });

    const res = await POST(postRequest({ email: "active@acme.com" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("This user has already set their password");
  });

  it("returns 400 when neither ID nor email is provided", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invitation ID or email is required");
  });

  it("returns 400 when email format is invalid", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ email: "notanemail" }));
    expect(res.status).toBe(400);
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
