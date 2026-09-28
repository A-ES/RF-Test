import { beforeEach, describe, expect, it, vi } from "vitest";

interface ReportRow {
  id: string;
  organizationId: string;
  title: string;
  type: string;
  accountName: string;
  size: string;
  status: string;
  fileUrl: string | null;
  createdAt: Date;
  project: { id: string; name: string } | null;
}

interface FindManyArgs {
  where?: { organizationId?: string; projectId?: string };
  take?: number;
}

const h = vi.hoisted(() => {
  const reports: ReportRow[] = [
    {
      id: "rep_a",
      organizationId: "org_a",
      title: "Acme QBR",
      type: "QBR Deck",
      accountName: "Acme Corp",
      size: "2 MB",
      status: "READY",
      fileUrl: null,
      createdAt: new Date("2026-09-10T00:00:00Z"),
      project: { id: "proj_a", name: "Proj A" },
    },
    {
      id: "rep_b",
      organizationId: "org_b",
      title: "Redwood QBR",
      type: "QBR Deck",
      accountName: "Redwood",
      size: "3 MB",
      status: "READY",
      fileUrl: null,
      createdAt: new Date("2026-09-11T00:00:00Z"),
      project: null,
    },
  ];

  const findMany = vi.fn(async (args: FindManyArgs) => {
    const organizationId = args?.where?.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      throw new Error("[tenant-guard] report.findMany missing organizationId");
    }
    let rows = reports.filter((row) => row.organizationId === organizationId);
    if (args.where?.projectId) {
      rows = rows.filter((row) => row.project?.id === args.where?.projectId);
    }
    return rows.slice(0, args.take ?? rows.length);
  });

  const getSession = vi.fn();
  return { reports, findMany, getSession, prisma: { report: { findMany } } };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/db", () => ({ prisma: h.prisma }));

import { GET } from "./route";
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reports", () => {
  it("returns only the caller's organization reports", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await GET(new Request("http://localhost/api/reports"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { reports: Array<{ id: string }> };
    expect(data.reports.map((r) => r.id)).toEqual(["rep_a"]);
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_a" }),
      }),
    );
  });

  it("supports filtering by projectId within the organization", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    const res = await GET(
      new Request("http://localhost/api/reports?projectId=proj_a"),
    );
    expect(res.status).toBe(200);
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_a", projectId: "proj_a" }),
      }),
    );
  });

  it("returns 401 without a session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/reports"));
    expect(res.status).toBe(401);
  });

  it("defaults the page size instead of clamping to a single row", async () => {
    h.getSession.mockResolvedValue(sessionFor("org_a"));
    await GET(new Request("http://localhost/api/reports"));
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});
