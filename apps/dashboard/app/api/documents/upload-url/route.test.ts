import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const projectFindFirst = vi.fn(
    async (args: { where?: { id?: string; organizationId?: string } }) => {
      const organizationId = args?.where?.organizationId;
      if (!organizationId) {
        throw new Error("[tenant-guard] project.findFirst missing organizationId");
      }
      if (args.where?.id === "proj_a" && organizationId === "org_a") {
        return { id: "proj_a" };
      }
      return null;
    },
  );

  const createPresignedUpload = vi.fn(
    async () => "https://s3.test/org_a/signed-put",
  );
  const isStorageConfigured = vi.fn(() => true);

  class StorageConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "StorageConfigError";
    }
  }

  const getSession = vi.fn();

  return {
    projectFindFirst,
    createPresignedUpload,
    isStorageConfigured,
    StorageConfigError,
    getSession,
    prisma: { project: { findFirst: projectFindFirst } },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/storage", () => ({
  isStorageConfigured: h.isStorageConfigured,
  createPresignedUpload: h.createPresignedUpload,
  StorageConfigError: h.StorageConfigError,
  PRESIGN_EXPIRES_IN_SECONDS: 300,
}));

import { POST } from "./route";
import { verifyUploadToken } from "@/app/lib/upload-token";
import { MAX_UPLOAD_BYTES } from "@/app/lib/uploads";
import type { Session } from "@/app/lib/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

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

function request(body: unknown): Request {
  return new Request("http://localhost/api/documents/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isStorageConfigured.mockReturnValue(true);
});

describe("POST /api/documents/upload-url", () => {
  it("returns a signed URL and a token bound to the organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(
      request({ fileName: "contract.pdf", mimeType: "application/pdf", fileSize: 2048 }),
    );
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      uploadUrl: string;
      uploadToken: string;
      headers: Record<string, string>;
    };
    expect(data.uploadUrl).toBe("https://s3.test/org_a/signed-put");
    expect(data.headers["Content-Type"]).toBe("application/pdf");

    const verified = verifyUploadToken(data.uploadToken);
    expect(verified?.organizationId).toBe("org_a");
    expect(verified?.userId).toBe("usr_a");
  });

  it("rejects a disallowed file type", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(
      request({ fileName: "malware.exe", mimeType: "application/octet-stream", fileSize: 10 }),
    );
    expect(res.status).toBe(400);
    expect(h.createPresignedUpload).not.toHaveBeenCalled();
  });

  it("rejects an oversize file", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(
      request({
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        fileSize: MAX_UPLOAD_BYTES + 1,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a project from another organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(
      request({
        fileName: "contract.pdf",
        mimeType: "application/pdf",
        fileSize: 2048,
        projectId: "proj_other",
      }),
    );
    expect(res.status).toBe(400);
    expect(h.createPresignedUpload).not.toHaveBeenCalled();
  });

  it("returns 503 when storage is not configured", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    h.isStorageConfigured.mockReturnValue(false);
    const res = await POST(
      request({ fileName: "contract.pdf", mimeType: "application/pdf", fileSize: 2048 }),
    );
    expect(res.status).toBe(503);
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await POST(
      request({ fileName: "contract.pdf", mimeType: "application/pdf", fileSize: 2048 }),
    );
    expect(res.status).toBe(401);
  });
});
