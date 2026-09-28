import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rfAdmins = [
    {
      id: "rfa_console_admin",
      name: "RF Console Admin",
      email: "admin@rf-intelligence.com",
      isActive: true,
    },
    {
      id: "rfa_suspended",
      name: "Suspended RF Console User",
      email: "suspended@rf-intelligence.com",
      isActive: false,
    },
  ];

  const users = [
    {
      id: "usr_jordan",
      organizationId: "org_acme",
      name: "Jordan Ellis",
      email: "jordan.ellis@acmecorp.com",
      role: "ADMIN",
    },
  ];

  const cookiesStore = new Map<string, string>();

  return { rfAdmins, users, cookiesStore };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const val = h.cookiesStore.get(name);
      return val ? { value: val } : undefined;
    },
  }),
}));

vi.mock("@/app/lib/db", () => ({
  prisma: {
    rfAdminUser: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return h.rfAdmins.find((a) => a.id === args.where.id) ?? null;
      }),
      update: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return h.users.find((u) => u.id === args.where.id) ?? null;
      }),
    },
  },
}));

import { createSessionToken } from "@/app/lib/session";
import { createRfAdminSessionToken, getRfAdminSession, verifyRfAdminSessionToken } from "@/app/lib/rf-admin-session";

describe("RF Admin identity separation", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test_super_secret_key_1234567890_32bytes";
    h.cookiesStore.clear();
    vi.clearAllMocks();
  });

  it("resolves an RF admin session in RF_ADMIN mode", async () => {
    h.cookiesStore.set("rf_admin_session", createRfAdminSessionToken("rfa_console_admin"));

    const session = await getRfAdminSession();
    expect(session?.mode).toBe("RF_ADMIN");
    expect(session?.adminId).toBe("rfa_console_admin");
  });

  it("does not resolve a client session as an RF admin session", async () => {
    // A validly-signed *client* token, placed in the admin cookie.
    h.cookiesStore.set("rf_admin_session", createSessionToken("usr_jordan"));

    expect(await getRfAdminSession()).toBeNull();
  });

  it("does not read the client session cookie at all", async () => {
    h.cookiesStore.set("rf_session", createSessionToken("usr_jordan"));

    expect(await getRfAdminSession()).toBeNull();
  });

  it("cannot resolve a regular User id, even when signed as an admin token", async () => {
    // The key invariant: minting a token around a client user id produces a
    // signature that is genuinely valid, but the id does not exist in
    // RfAdminUser, so it resolves to nothing. There is no code path by which
    // a data bug on `users` grants RF Admin.
    const token = createRfAdminSessionToken("usr_jordan");
    expect(verifyRfAdminSessionToken(token)).not.toBeNull();

    h.cookiesStore.set("rf_admin_session", token);
    expect(await getRfAdminSession()).toBeNull();
  });

  it("rejects a client session token under admin verification", () => {
    expect(verifyRfAdminSessionToken(createSessionToken("rfa_console_admin"))).toBeNull();
  });

  it("treats a deactivated admin as signed out", async () => {
    h.cookiesStore.set("rf_admin_session", createRfAdminSessionToken("rfa_suspended"));

    expect(await getRfAdminSession()).toBeNull();
  });

  it("rejects a tampered admin token", async () => {
    const [payloadPart, sigPart] = createRfAdminSessionToken("rfa_console_admin").split(".");
    const decoded = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    decoded.uid = "rfa_suspended";
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sigPart}`;

    expect(verifyRfAdminSessionToken(tampered)).toBeNull();

    h.cookiesStore.set("rf_admin_session", tampered);
    expect(await getRfAdminSession()).toBeNull();
  });
});
