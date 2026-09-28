import { beforeEach, describe, expect, it, vi } from "vitest";

interface InsightRow {
  id: string;
  organizationId: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  accountName: string | null;
  whatHappened: string;
  whyDetected: string;
  businessImpact: string;
  recommendedAction: string;
  createdAt: Date;
}

interface ProjectRow {
  id: string;
  organizationId: string;
  name: string;
  accountName: string;
  status: string;
  progress: number;
  dueDate: Date;
  openTasksCount: number;
  createdAt: Date;
}

interface ReportRow {
  id: string;
  organizationId: string;
  title: string;
  type: string;
  accountName: string;
  status: string;
  size: string;
  createdAt: Date;
}

interface DocumentRow {
  id: string;
  organizationId: string;
  fileName: string;
  fileSize: string;
  linkedAccount: string | null;
  extractedEntitiesCount: number;
  metadataJson: string | null;
  createdAt: Date;
}

interface AskRfQueryRow {
  organizationId: string;
  userId: string;
  queryText: string;
  answerText: string;
  sourcesJson: string;
}

interface FindManyArgs {
  where?: { organizationId?: string };
  take?: number;
}

const h = vi.hoisted(() => {
  const insights: InsightRow[] = [
    {
      id: "ins_a",
      organizationId: "org_a",
      type: "RISK",
      severity: "CRITICAL",
      title: "Bluebird renewal at risk",
      body: "BLUEBIRD-ONLY sponsor turnover detected.",
      accountName: "Bluebird",
      whatHappened: "BLUEBIRD-ONLY executive sponsor left.",
      whyDetected: "BLUEBIRD-ONLY sentiment fell.",
      businessImpact: "BLUEBIRD-ONLY revenue at risk.",
      recommendedAction: "BLUEBIRD-ONLY exec alignment call.",
      createdAt: new Date("2026-09-10T00:00:00Z"),
    },
    {
      id: "ins_b",
      organizationId: "org_b",
      type: "OPPORTUNITY",
      severity: "INFO",
      title: "Redwood expansion opportunity",
      body: "REDWOOD-ONLY seat expansion identified.",
      accountName: "Redwood",
      whatHappened: "REDWOOD-ONLY usage grew.",
      whyDetected: "REDWOOD-ONLY intent keywords.",
      businessImpact: "REDWOOD-ONLY upsell available.",
      recommendedAction: "REDWOOD-ONLY send proposal.",
      createdAt: new Date("2026-09-09T00:00:00Z"),
    },
  ];

  const projects: ProjectRow[] = [
    {
      id: "proj_a",
      organizationId: "org_a",
      name: "Bluebird Renewal Prep",
      accountName: "Bluebird",
      status: "AT_RISK",
      progress: 40,
      dueDate: new Date("2026-09-20T00:00:00Z"),
      openTasksCount: 5,
      createdAt: new Date("2026-09-01T00:00:00Z"),
    },
    {
      id: "proj_b",
      organizationId: "org_b",
      name: "Redwood Onboarding",
      accountName: "Redwood",
      status: "ON_TRACK",
      progress: 90,
      dueDate: new Date("2026-09-15T00:00:00Z"),
      openTasksCount: 1,
      createdAt: new Date("2026-09-02T00:00:00Z"),
    },
  ];

  const reports: ReportRow[] = [
    {
      id: "rep_a",
      organizationId: "org_a",
      title: "Bluebird QBR",
      type: "QBR Deck",
      accountName: "Bluebird",
      status: "READY",
      size: "5 MB",
      createdAt: new Date("2026-09-05T00:00:00Z"),
    },
    {
      id: "rep_b",
      organizationId: "org_b",
      title: "Redwood Health Scorecard",
      type: "Health Scorecard",
      accountName: "Redwood",
      status: "READY",
      size: "3 MB",
      createdAt: new Date("2026-09-06T00:00:00Z"),
    },
  ];

  const documents: DocumentRow[] = [
    {
      id: "doc_a",
      organizationId: "org_a",
      fileName: "notes.txt",
      fileSize: "3 KB",
      linkedAccount: "Bluebird",
      extractedEntitiesCount: 2,
      metadataJson: null,
      createdAt: new Date("2026-09-07T00:00:00Z"),
    },
    {
      id: "doc_b",
      organizationId: "org_b",
      fileName: "other.txt",
      fileSize: "1 KB",
      linkedAccount: null,
      extractedEntitiesCount: 0,
      metadataJson: null,
      createdAt: new Date("2026-09-08T00:00:00Z"),
    },
  ];

  const askRfQueries: AskRfQueryRow[] = [];

  const requireOrg = (args: FindManyArgs | undefined, table: string) => {
    const organizationId = args?.where?.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      throw new Error(
        `[tenant-guard] ${table}.findMany was called without organizationId`,
      );
    }
    return organizationId;
  };

  const makeFindMany = <T extends { organizationId: string }>(table: T[]) =>
    vi.fn(async (args: FindManyArgs) => {
      const organizationId = requireOrg(args, "table");
      const rows = table.filter((row) => row.organizationId === organizationId);
      const take = typeof args?.take === "number" ? args.take : rows.length;
      return rows.slice(0, take);
    });

  const fakePrisma = {
    insight: { findMany: makeFindMany(insights) },
    project: { findMany: makeFindMany(projects) },
    report: { findMany: makeFindMany(reports) },
    document: { findMany: makeFindMany(documents) },
    askRfQuery: {
      create: vi.fn(async ({ data }: { data: AskRfQueryRow }) => {
        askRfQueries.push(data);
        return data;
      }),
    },
  };

  const getSession = vi.fn();
  const askDeepSeek = vi.fn();

  class DeepSeekConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "DeepSeekConfigError";
    }
  }

  return {
    insights,
    projects,
    reports,
    documents,
    askRfQueries,
    fakePrisma,
    getSession,
    askDeepSeek,
    DeepSeekConfigError,
  };
});

vi.mock("@/app/lib/db", () => ({ prisma: h.fakePrisma }));
vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/deepseek", () => ({
  askDeepSeek: h.askDeepSeek,
  DeepSeekConfigError: h.DeepSeekConfigError,
}));

import { POST } from "./route";
import { resetRateLimit } from "@/app/lib/rate-limit";
import type { RetrievedSource } from "@/app/lib/retrieval";
import type { Session } from "@/app/lib/session";

const QUESTION = "Which accounts are most at risk this quarter?";

function sessionFor(userId: string, organizationId: string): Session {
  return {
          mode: "CLIENT",
    userId,
    organizationId,
    name: userId,
    email: `${userId}@example.com`,
    role: "MEMBER",
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ask-rf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

import { clearAskRfCache } from "@/lib/ask-rf/cache";

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimit();
  clearAskRfCache();
  h.askRfQueries.length = 0;
  // Echo the context back so the answer reflects exactly what DeepSeek received.
  h.askDeepSeek.mockImplementation(
    async (_question: string, sources: RetrievedSource[]) =>
      sources.map((source) => source.summary).join(" || "),
  );
});

describe("POST /api/ask-rf", () => {
  it("never cross-references another organization's data", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    const resA = await POST(makeRequest({ question: QUESTION }));
    expect(resA.status).toBe(200);
    const jsonA = (await resA.json()) as { answer: string; sources: Array<{ id: string }> };

    expect(jsonA.answer).toContain("BLUEBIRD-ONLY");
    expect(jsonA.answer).not.toContain("REDWOOD-ONLY");
    expect(jsonA.sources.map((source) => source.id)).toEqual(
      expect.not.arrayContaining(["ins_b", "proj_b", "rep_b"]),
    );

    const contextA = h.askDeepSeek.mock.calls[0][1] as RetrievedSource[];
    expect(contextA.some((source) => source.id === "ins_b")).toBe(false);

    h.getSession.mockResolvedValue(sessionFor("usr_b", "org_b"));
    const resB = await POST(makeRequest({ question: QUESTION }));
    expect(resB.status).toBe(200);
    const jsonB = (await resB.json()) as { answer: string; sources: Array<{ id: string }> };

    expect(jsonB.answer).toContain("REDWOOD-ONLY");
    expect(jsonB.answer).not.toContain("BLUEBIRD-ONLY");
    expect(jsonB.sources.map((source) => source.id)).toEqual(
      expect.not.arrayContaining(["ins_a", "proj_a", "rep_a"]),
    );

    const contextB = h.askDeepSeek.mock.calls[1][1] as RetrievedSource[];
    expect(contextB.some((source) => source.id === "ins_a")).toBe(false);
  });

  it("ignores a client-supplied organizationId (no privilege escalation)", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));

    const res = await POST(
      makeRequest({
        question: QUESTION,
        organizationId: "org_b",
        userId: "usr_b",
      }),
    );
    const json = (await res.json()) as { answer: string };

    expect(json.answer).not.toContain("REDWOOD-ONLY");
    expect(h.askRfQueries.at(-1)?.organizationId).toBe("org_a");
    expect(h.askRfQueries.at(-1)?.userId).toBe("usr_a");
  });

  it("scopes every retrieval query by organizationId", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    await POST(makeRequest({ question: QUESTION }));

    expect(h.fakePrisma.insight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_a" } }),
    );
    expect(h.fakePrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_a" } }),
    );
    expect(h.fakePrisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org_a" }) }),
    );
    expect(h.fakePrisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org_a" }) }),
    );
  });

  it("logs the question, answer and source ids to AskRfQuery", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    await POST(makeRequest({ question: QUESTION }));

    const log = h.askRfQueries.at(-1);
    expect(log).toBeDefined();
    expect(log?.organizationId).toBe("org_a");
    expect(log?.userId).toBe("usr_a");
    expect(log?.queryText).toBe(QUESTION);
    expect(log?.answerText).toContain("BLUEBIRD-ONLY");
    expect(JSON.parse(log?.sourcesJson ?? "[]")).toEqual(
      expect.arrayContaining(["ins_a", "proj_a", "rep_a"]),
    );
  });

  it("returns 401 when there is no session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await POST(makeRequest({ question: QUESTION }));
    expect(res.status).toBe(401);
    expect(h.askDeepSeek).not.toHaveBeenCalled();
  });

  it("rejects an empty question", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    const res = await POST(makeRequest({ question: "   " }));
    expect(res.status).toBe(400);
  });

  it("rate limits per user", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_rate", "org_a"));

    for (let i = 0; i < 10; i += 1) {
      const res = await POST(makeRequest({ question: QUESTION }));
      expect(res.status).toBe(200);
    }

    const limited = await POST(makeRequest({ question: QUESTION }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 503 when DeepSeek is not configured", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    h.askDeepSeek.mockRejectedValueOnce(new h.DeepSeekConfigError("missing key"));

    const res = await POST(makeRequest({ question: QUESTION }));
    expect(res.status).toBe(503);
  });

  it("returns 502 when DeepSeek fails", async () => {
    h.getSession.mockResolvedValue(sessionFor("usr_a", "org_a"));
    h.askDeepSeek.mockRejectedValueOnce(new Error("upstream down"));

    const res = await POST(makeRequest({ question: QUESTION }));
    expect(res.status).toBe(502);
  });
});
