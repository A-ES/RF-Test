import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const userFindFirst = vi.fn();
  const invUpdateMany = vi.fn(async () => ({ count: 1 }));
  const invCreate = vi.fn(async () => ({
    id: "inv_resend_1",
    email: "pending@acme.com",
    role: "MEMBER",
    expiresAt: new Date(Date.now() + 7 * 86400000),
  }));
  const invUpdate = vi.fn(async () => ({}));
  const orgFindUnique = vi.fn(async () => ({ name: "Acme Corp" }));
  const sendEmail = vi.fn(async () => ({ delivered: true }));
  const auditCreate = vi.fn(async () => ({}));

  return {
    getSession,
    userFindFirst,
    invUpdateMany,
    invCreate,
    invUpdate,
    orgFindUnique,
    sendEmail,
    auditCreate,
    prisma: {
      user: { findFirst: userFindFirst },
      invitation: {
        updateMany: invUpdateMany,
        create: invCreate,
        update: invUpdate,
      },
      organization: { findUnique: orgFindUnique },
      auditLog: { create: auditCreate },
    },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/email", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/app/lib/invite-token", () => ({
  createInviteToken: vi.fn(() => "mock_token"),
}));
vi.mock("@/app/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 9, retryAfterSeconds: 0 })),
}));

import { POST } from "./route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/organization/invitations/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/organization/invitations/resend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    h.getSession.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ email: "user@acme.com" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when not ADMIN", async () => {
    h.getSession.mockResolvedValueOnce({
      userId: "usr_1",
      organizationId: "org_1",
      role: "MEMBER",
    });
    const res = await POST(makeRequest({ email: "user@acme.com" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when user has already set password", async () => {
    h.getSession.mockResolvedValueOnce({
      userId: "usr_admin",
      organizationId: "org_1",
      role: "ADMIN",
      name: "Admin User",
    });
    h.userFindFirst.mockResolvedValueOnce({
      id: "usr_active",
      passwordHash: "scrypt$16384$8$1$salt$hash",
      role: "MEMBER",
    });

    const res = await POST(makeRequest({ email: "active@acme.com" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("This user has already set their password");
  });

  it("resends invitation for user with null passwordHash", async () => {
    h.getSession.mockResolvedValueOnce({
      userId: "usr_admin",
      organizationId: "org_1",
      role: "ADMIN",
      name: "Admin User",
    });
    h.userFindFirst.mockResolvedValueOnce({
      id: "usr_seed",
      passwordHash: null,
      role: "MEMBER",
    });

    const res = await POST(makeRequest({ email: "seed@acme.com" }));
    expect(res.status).toBe(200);

    expect(h.invUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
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
});
