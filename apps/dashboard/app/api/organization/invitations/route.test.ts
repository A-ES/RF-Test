import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/app/lib/session";

const h = vi.hoisted(() => {
  const invitation = {
    id: "inv_1",
    organizationId: "org_a",
    invitedById: "usr_admin",
    email: "new@acme.com",
    role: "MEMBER",
    token: "tok_abc",
    status: "PENDING",
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    invitedBy: { name: "Admin", email: "admin@acme.com" },
  };

  const invFindMany = vi.fn(async () => [invitation]);
  const invCreate = vi.fn(async () => ({ ...invitation }));
  const invUpdate = vi.fn(async () => ({ ...invitation }));
  const invUpdateMany = vi.fn(async () => ({ count: 0 }));

  const userFindUnique = vi.fn(async (args: { where: { email: string } }) => {
    if (args.where.email === "existing@acme.com")
      return { id: "usr_existing", organizationId: "org_a" };
    if (args.where.email === "other@other.com")
      return { id: "usr_other", organizationId: "org_b" };
    return null;
  });

  const orgFindUnique = vi.fn(async () => ({ name: "Acme Corp" }));
  const auditCreate = vi.fn(async () => ({}));
  const sendEmail = vi.fn(async () => ({ delivered: true, provider: "console" }));

  const getSession = vi.fn<() => Promise<Session | null>>();

  return {
    invitation,
    invFindMany,
    invCreate,
    invUpdate,
    invUpdateMany,
    userFindUnique,
    orgFindUnique,
    auditCreate,
    sendEmail,
    getSession,
    prisma: {
      invitation: { findMany: invFindMany, create: invCreate, update: invUpdate, updateMany: invUpdateMany },
      user: { findUnique: userFindUnique },
      organization: { findUnique: orgFindUnique },
      auditLog: { create: auditCreate },
    },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/email", () => ({ sendEmail: h.sendEmail }));
// Stub invite token so we don't need AUTH_SECRET in tests
vi.mock("@/app/lib/invite-token", () => ({
  createInviteToken: vi.fn(() => "signed_token_stub"),
}));
// Stub rate-limit to always allow in tests
vi.mock("@/app/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 9, retryAfterSeconds: 0 })),
}));

import { GET, POST } from "./route";

function adminSession(): Session {
  return {
          mode: "CLIENT",
    userId: "usr_admin",
    organizationId: "org_a",
    name: "Admin",
    email: "admin@acme.com",
    role: "ADMIN",
  };
}

function memberSession(): Session {
  return {
          mode: "CLIENT",
    userId: "usr_member",
    organizationId: "org_a",
    name: "Member",
    email: "member@acme.com",
    role: "MEMBER",
  };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/organization/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/organization/invitations", () => {
  it("returns pending invitations for an Admin", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { invitations: Array<{ id: string }> };
    expect(data.invitations[0]?.id).toBe("inv_1");
    expect(h.invFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_a",
          status: "PENDING",
        }),
      }),
    );
  });

  it("returns 403 for a non-Admin", async () => {
    h.getSession.mockResolvedValue(memberSession());
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("POST /api/organization/invitations", () => {
  it("creates an invitation, patches the token, and sends an email", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ email: "new@acme.com", role: "MEMBER" }));
    expect(res.status).toBe(201);
    // Row created with placeholder token
    expect(h.invCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org_a",
          email: "new@acme.com",
          role: "MEMBER",
          token: "pending",
        }),
      }),
    );
    // Token patched after creation
    expect(h.invUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { token: "signed_token_stub" } }),
    );
    // Email sent
    expect(h.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "new@acme.com" }),
    );
    // Audit logged
    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "INVITATION_SENT" }),
      }),
    );
  });

  it("accepts ADMIN role", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ email: "new@acme.com", role: "ADMIN" }));
    expect(res.status).toBe(201);
    expect(h.invCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "ADMIN" }) }),
    );
  });

  it("normalises role to uppercase", async () => {
    h.getSession.mockResolvedValue(adminSession());
    await POST(postRequest({ email: "new@acme.com", role: "member" }));
    expect(h.invCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "MEMBER" }) }),
    );
  });

  it("returns 409 when the email is already a member of this org", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ email: "existing@acme.com" }));
    expect(res.status).toBe(409);
    expect(h.invCreate).not.toHaveBeenCalled();
  });

  it("returns 409 when the email belongs to another org", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ email: "other@other.com" }));
    expect(res.status).toBe(409);
    expect(h.invCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing email", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ role: "MEMBER" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed email", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ email: "notanemail" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid role", async () => {
    h.getSession.mockResolvedValue(adminSession());
    const res = await POST(postRequest({ email: "new@acme.com", role: "MANAGER" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-Admin", async () => {
    h.getSession.mockResolvedValue(memberSession());
    const res = await POST(postRequest({ email: "new@acme.com" }));
    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await POST(postRequest({ email: "new@acme.com" }));
    expect(res.status).toBe(401);
  });
});
