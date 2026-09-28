import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const isRealtimeConfigured = vi.fn(() => false);
  const createChannelTokenRequest = vi.fn(async () => ({
    clientId: "usr_a",
    capability: '{"rf-intel:org:org_a:messages":["subscribe"]}',
  }));
  return { getSession, isRealtimeConfigured, createChannelTokenRequest };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/realtime/server", () => ({
  isRealtimeConfigured: h.isRealtimeConfigured,
  createChannelTokenRequest: h.createChannelTokenRequest,
}));

import { GET, POST } from "./route";
import { orgChannel } from "@/app/lib/realtime/channels";
import type { Session } from "@/app/lib/session";

function sessionFor(organizationId: string): Session {
  return {
          mode: "CLIENT",
    userId: "usr_a",
    organizationId,
    name: "Test",
    email: "test@example.com",
    role: "MEMBER",
  };
}

function authRequest(channel: string): Request {
  return new Request(
    `http://localhost/api/realtime/auth?channel=${encodeURIComponent(channel)}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isRealtimeConfigured.mockReturnValue(false);
});

describe("GET /api/realtime/auth", () => {
  it("authorizes a channel scoped to the caller's organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    h.isRealtimeConfigured.mockReturnValue(true);

    const res = await GET(authRequest(orgChannel("org_a", "messages")));
    expect(res.status).toBe(200);
    expect(h.createChannelTokenRequest).toHaveBeenCalledWith(
      "rf-intel:org:org_a:messages",
      "usr_a",
    );
  });

  it("forbids a channel scoped to another organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    h.isRealtimeConfigured.mockReturnValue(true);

    const res = await GET(authRequest(orgChannel("org_b", "messages")));
    expect(res.status).toBe(403);
    expect(h.createChannelTokenRequest).not.toHaveBeenCalled();
  });

  it("rejects an unknown channel name", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await GET(authRequest("some-other-channel"));
    expect(res.status).toBe(400);
  });

  it("reports 503 when realtime is not configured", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await GET(authRequest(orgChannel("org_a", "messages")));
    expect(res.status).toBe(503);
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET(authRequest(orgChannel("org_a", "messages")));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/realtime/auth", () => {
  it("reads the channel from the request body", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    h.isRealtimeConfigured.mockReturnValue(true);

    const res = await POST(
      new Request("http://localhost/api/realtime/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: orgChannel("org_a", "notifications") }),
      }),
    );
    expect(res.status).toBe(200);
    expect(h.createChannelTokenRequest).toHaveBeenCalledWith(
      "rf-intel:org:org_a:notifications",
      "usr_a",
    );
  });
});
