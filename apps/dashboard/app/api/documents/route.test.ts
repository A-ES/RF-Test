import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface DocRow {
  id: string;
  organizationId: string;
  fileName: string;
  fileSize: string;
  fileUrl: string;
  mimeType: string | null;
  processingStatus: string;
  linkedAccount: string | null;
  extractedEntitiesCount: number;
  failureReason: string | null;
  createdAt: Date;
  project: { id: string; name: string } | null;
}

interface FindManyArgs {
  where?: {
    organizationId?: string;
    projectId?: string;
    processingStatus?: string;
  };
  take?: number;
}

const h = vi.hoisted(() => {
  const documents: DocRow[] = [
    {
      id: "doc_a",
      organizationId: "org_a",
      fileName: "a.pdf",
      fileSize: "2.0 KB",
      fileUrl: "https://cdn.test/a.pdf",
      mimeType: "application/pdf",
      processingStatus: "PROCESSED",
      linkedAccount: null,
      extractedEntitiesCount: 3,
      failureReason: null,
      createdAt: new Date("2026-09-10T00:00:00Z"),
      project: { id: "proj_a", name: "Proj A" },
    },
    {
      id: "doc_b",
      organizationId: "org_b",
      fileName: "b.pdf",
      fileSize: "1.0 KB",
      fileUrl: "https://cdn.test/b.pdf",
      mimeType: "application/pdf",
      processingStatus: "PENDING",
      linkedAccount: null,
      extractedEntitiesCount: 0,
      failureReason: null,
      createdAt: new Date("2026-09-11T00:00:00Z"),
      project: null,
    },
  ];

  const findMany = vi.fn(async (args: FindManyArgs) => {
    const organizationId = args?.where?.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      throw new Error("[tenant-guard] document.findMany missing organizationId");
    }
    let rows = documents.filter((row) => row.organizationId === organizationId);
    if (args.where?.projectId) {
      rows = rows.filter((row) => row.project?.id === args.where?.projectId);
    }
    if (args.where?.processingStatus) {
      rows = rows.filter(
        (row) => row.processingStatus === args.where?.processingStatus,
      );
    }
    return rows.slice(0, args.take ?? rows.length);
  });

  const create = vi.fn(
    async (args: { data: Record<string, unknown>; include?: unknown }) => ({
      id: "doc_new",
      project: null,
      createdAt: new Date("2026-09-18T00:00:00Z"),
      failureReason: null,
      extractedEntitiesCount: 0,
      ...args.data,
    }),
  );

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

  const headObject = vi.fn();
  const isStorageConfigured = vi.fn(() => true);
  const send = vi.fn();
  const getSession = vi.fn();

  return {
    documents,
    findMany,
    create,
    projectFindFirst,
    headObject,
    isStorageConfigured,
    send,
    getSession,
    prisma: {
      document: { findMany, create },
      project: { findFirst: projectFindFirst },
    },
  };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/app/lib/storage", () => ({
  isStorageConfigured: h.isStorageConfigured,
  headObject: h.headObject,
  buildPublicUrl: (key: string) => `https://cdn.test/${key}`,
}));
vi.mock("@/app/lib/inngest/client", () => ({
  inngest: { send: h.send },
  DOCUMENT_PROCESS_EVENT: "document/process.requested",
}));

import { GET, POST } from "./route";
import { createUploadToken } from "@/app/lib/upload-token";
import type { Session } from "@/app/lib/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

function sessionFor(organizationId: string, userId = "usr_a"): Session {
  return {
          mode: "CLIENT",
    userId,
    organizationId,
    name: userId,
    email: `${userId}@example.com`,
    role: "MEMBER",
  };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isStorageConfigured.mockReturnValue(true);
});

describe("GET /api/documents", () => {
  it("returns only the caller's organization documents", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await GET(new Request("http://localhost/api/documents"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { documents: Array<{ id: string }> };
    expect(data.documents.map((d) => d.id)).toEqual(["doc_a"]);
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_a" }),
      }),
    );
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/documents"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/documents", () => {
  const validToken = () =>
    createUploadToken({
      key: "org_a/2026/abc-a.pdf",
      organizationId: "org_a",
      userId: "usr_a",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      size: 2048,
    });

  it("confirms the upload, creates a PENDING document and enqueues processing", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    h.headObject.mockResolvedValue({ contentLength: 2048, contentType: "application/pdf" });
    h.send.mockResolvedValue({ ids: ["evt_1"] });

    const res = await POST(postRequest({ uploadToken: validToken() }));
    expect(res.status).toBe(201);

    const createArg = h.create.mock.calls[0][0] as {
      data: { processingStatus: string; organizationId: string; uploadedById: string; projectId: string | null };
    };
    expect(createArg.data.processingStatus).toBe("PENDING");
    expect(createArg.data.organizationId).toBe("org_a");
    expect(createArg.data.uploadedById).toBe("usr_a");
    expect(createArg.data.projectId).toBeNull();

    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "document/process.requested",
        data: expect.objectContaining({ organizationId: "org_a" }),
      }),
    );
  });

  it("rejects an upload token minted for another organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const foreignToken = createUploadToken({
      key: "org_b/2026/abc-b.pdf",
      organizationId: "org_b",
      userId: "usr_b",
      fileName: "b.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });

    const res = await POST(postRequest({ uploadToken: foreignToken }));
    expect(res.status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await POST(postRequest({ uploadToken: "not-a-real-token" }));
    expect(res.status).toBe(400);
  });

  it("returns 503 when storage is not configured", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    h.isStorageConfigured.mockReturnValue(false);
    const res = await POST(postRequest({ uploadToken: validToken() }));
    expect(res.status).toBe(503);
  });
});
