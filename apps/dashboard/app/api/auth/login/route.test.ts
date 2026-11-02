import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@rf-intelligence/db";
import { createHash } from "node:crypto";

const h = vi.hoisted(() => {
  const auditCreate = vi.fn(async () => ({}));
  const setSessionCookie = vi.fn(async () => {});
  const userUpdate = vi.fn(async () => ({}));
  const userFindUnique = vi.fn();
  const orgFindFirst = vi.fn(async () => ({ id: "org_default" }));

  return {
    auditCreate,
    setSessionCookie,
    userUpdate,
    userFindUnique,
    orgFindFirst,
    prisma: {
      user: {
        findUnique: userFindUnique,
        update: userUpdate,
      },
      organization: {
        findFirst: orgFindFirst,
      },
      auditLog: {
        create: auditCreate,
      },
    },
  };
});

vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/session", () => ({ setSessionCookie: h.setSessionCookie }));

import { POST } from "./route";

function makeRequest(body: unknown, ip = "127.0.0.1"): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when email or password is missing", async () => {
    const res1 = await POST(makeRequest({ email: "user@example.com" }));
    expect(res1.status).toBe(400);

    const res2 = await POST(makeRequest({ password: "secret" }));
    expect(res2.status).toBe(400);
  });

  it("returns 401 and writes audit log on unknown email (runs dummy hash)", async () => {
    h.userFindUnique.mockResolvedValueOnce(null);

    const res = await POST(
      makeRequest({ email: "unknown@example.com", password: "wrongpassword" }, "198.51.100.1"),
    );
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Invalid email or password");

    expect(h.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "LOGIN_FAILED",
        entityType: "User",
        metadataJson: expect.stringContaining("unknown@example.com"),
      }),
    });

    const callArgs = h.auditCreate.mock.calls[0][0];
    const meta = JSON.parse(callArgs.data.metadataJson);
    expect(meta.email).toBe("unknown@example.com");
    expect(meta.ip).toBe("198.51.100.1");
    expect(meta.timestamp).toBeDefined();
    expect(meta.password).toBeUndefined(); // NEVER log password
  });

  it("returns 401 when user has null passwordHash (no demo fallback)", async () => {
    h.userFindUnique.mockResolvedValueOnce({
      id: "usr_null",
      organizationId: "org_1",
      passwordHash: null,
    });

    const res = await POST(
      makeRequest({ email: "nullpw@example.com", password: "password" }),
    );
    expect(res.status).toBe(401);
    expect(h.setSessionCookie).not.toHaveBeenCalled();

    expect(h.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        userId: "usr_null",
        action: "LOGIN_FAILED",
      }),
    });
  });

  it("returns 401 when password is wrong for scrypt-hashed user", async () => {
    const hash = await hashPassword("correctpassword");
    h.userFindUnique.mockResolvedValueOnce({
      id: "usr_scrypt",
      organizationId: "org_1",
      passwordHash: hash,
    });

    const res = await POST(
      makeRequest({ email: "scrypt@example.com", password: "wrongpassword" }),
    );
    expect(res.status).toBe(401);
    expect(h.setSessionCookie).not.toHaveBeenCalled();
    expect(h.auditCreate).toHaveBeenCalled();
  });

  it("returns 200 and sets cookie on valid scrypt password", async () => {
    const hash = await hashPassword("correctpassword");
    h.userFindUnique.mockResolvedValueOnce({
      id: "usr_scrypt",
      organizationId: "org_1",
      passwordHash: hash,
    });

    const res = await POST(
      makeRequest({ email: "scrypt@example.com", password: "correctpassword" }),
    );
    expect(res.status).toBe(200);
    expect(h.setSessionCookie).toHaveBeenCalledWith("usr_scrypt");
    expect(h.userUpdate).not.toHaveBeenCalled(); // Already up-to-date scrypt
  });

  it("accepts legacy SHA-256 hash and transparently upgrades to scrypt", async () => {
    const legacyDigest = createHash("sha256").update("legacypassword").digest("hex");
    h.userFindUnique.mockResolvedValueOnce({
      id: "usr_legacy",
      organizationId: "org_1",
      passwordHash: legacyDigest,
    });

    const res = await POST(
      makeRequest({ email: "legacy@example.com", password: "legacypassword" }),
    );
    expect(res.status).toBe(200);
    expect(h.setSessionCookie).toHaveBeenCalledWith("usr_legacy");

    // Must rehash and save to DB
    expect(h.userUpdate).toHaveBeenCalledWith({
      where: { id: "usr_legacy" },
      data: {
        passwordHash: expect.stringMatching(/^scrypt\$16384\$8\$1\$/),
      },
    });
  });
});
