import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/app/lib/session";

interface UserRecord {
  id: string;
  name: string;
  organizationId: string;
  avatarInitials?: string;
}

interface TaskRecord {
  id: string;
  organizationId: string;
  projectId: string | null;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate: Date | null;
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DocumentRecord {
  id: string;
  organizationId: string;
  uploadedById: string;
  projectId: string | null;
  fileName: string;
  fileSize: string;
  fileUrl: string;
  storageKey?: string | null;
  mimeType?: string | null;
  processingStatus: "PENDING" | "PROCESSED" | "FAILED";
  extractedEntitiesCount: number;
  failureReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ReportRecord {
  id: string;
  organizationId: string;
  createdById: string;
  projectId: string | null;
  title: string;
  type: string;
  accountName: string;
  size: string;
  status: "READY" | "PROCESSING" | "FAILED";
  fileUrl?: string | null;
  createdAt: Date;
}

interface InsightRecord {
  id: string;
  organizationId: string;
  projectId: string | null;
  type: "RISK" | "OPPORTUNITY" | "EFFICIENCY";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  body: string;
  accountName?: string | null;
  ctaHref: string;
  ctaLabel: string;
  read: boolean;
  whatHappened: string;
  whyDetected: string;
  chartTitle: string;
  chartType: string;
  chartDataJson: string;
  businessImpact: string;
  recommendedAction: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectRecord {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  accountName: string;
  status: "ON_TRACK" | "AT_RISK" | "BLOCKED" | "COMPLETED";
  progress: number;
  openTasksCount: number;
  dueDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const h = vi.hoisted(() => {
  const users: UserRecord[] = [
    { id: "usr_orgA_lead", name: "Alice Lead", organizationId: "org_a", avatarInitials: "AL" },
    { id: "usr_orgB_lead", name: "Bob Other", organizationId: "org_b", avatarInitials: "BO" },
  ];

  const projects: ProjectRecord[] = [];
  const tasks: TaskRecord[] = [];
  const documents: DocumentRecord[] = [];
  const reports: ReportRecord[] = [];
  const insights: InsightRecord[] = [];
  const activities: Array<{ id: string; projectId: string; action: string; createdAt: Date }> = [];

  const getSession = vi.fn<() => Promise<Session | null>>();

  return { users, projects, tasks, documents, reports, insights, activities, getSession };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
vi.mock("@/app/lib/data-sync", () => ({ notifyOrgDataChanged: vi.fn() }));
vi.mock("@/app/lib/storage", () => ({
  isStorageConfigured: vi.fn(() => true),
  createPresignedDownload: vi.fn(async ({ key, filename }: { key: string; filename?: string }) =>
    `https://storage.mock.s3/presigned/${key}?filename=${filename ?? "download"}`
  ),
}));

vi.mock("@/app/lib/db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async (args: { where: { id: string; organizationId: string } }) =>
        h.users.find((u) => u.id === args.where.id && u.organizationId === args.where.organizationId) ?? null
      ),
    },
    project: {
      findMany: vi.fn(async (args: { where: { organizationId: string } }) => {
        const found = h.projects.filter((p) => p.organizationId === args.where.organizationId);
        return found.map((p) => ({
          ...p,
          owner: h.users.find((u) => u.id === p.ownerId)!,
          tasks: h.tasks
            .filter((t) => t.projectId === p.id)
            .map((t) => ({ ...t, assignee: h.users.find((u) => u.id === t.assigneeId) ?? null })),
          activities: h.activities.filter((a) => a.projectId === p.id).map((a) => ({
            ...a,
            details: null,
            type: "task",
            author: { id: "usr_orgA_lead", name: "Alice Lead", avatarInitials: "AL" },
          })),
          documents: h.documents.filter((d) => d.projectId === p.id),
          reports: h.reports.filter((r) => r.projectId === p.id),
          insights: h.insights.filter((i) => i.projectId === p.id),
        }));
      }),
      findFirst: vi.fn(async (args: { where: { id: string; organizationId: string } }) => {
        const p = h.projects.find((proj) => proj.id === args.where.id && proj.organizationId === args.where.organizationId);
        if (!p) return null;
        return {
          ...p,
          owner: h.users.find((u) => u.id === p.ownerId)!,
          tasks: h.tasks
            .filter((t) => t.projectId === p.id)
            .map((t) => ({ ...t, assignee: h.users.find((u) => u.id === t.assigneeId) ?? null })),
          activities: h.activities.filter((a) => a.projectId === p.id).map((a) => ({
            ...a,
            details: null,
            type: "task",
            author: { id: "usr_orgA_lead", name: "Alice Lead", avatarInitials: "AL" },
          })),
          documents: h.documents.filter((d) => d.projectId === p.id),
          reports: h.reports.filter((r) => r.projectId === p.id),
          insights: h.insights.filter((i) => i.projectId === p.id),
        };
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const p = h.projects.find((proj) => proj.id === args.where.id);
        if (!p) return null;
        return {
          ...p,
          owner: h.users.find((u) => u.id === p.ownerId)!,
          tasks: h.tasks
            .filter((t) => t.projectId === p.id)
            .map((t) => ({ ...t, assignee: h.users.find((u) => u.id === t.assigneeId) ?? null })),
          activities: h.activities.filter((a) => a.projectId === p.id).map((a) => ({
            ...a,
            details: null,
            type: "task",
            author: { id: "usr_orgA_lead", name: "Alice Lead", avatarInitials: "AL" },
          })),
          documents: h.documents.filter((d) => d.projectId === p.id),
          reports: h.reports.filter((r) => r.projectId === p.id),
          insights: h.insights.filter((i) => i.projectId === p.id),
        };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: any }) => {
        const idx = h.projects.findIndex((p) => p.id === args.where.id);
        if (idx === -1) throw new Error("Project not found");
        h.projects[idx] = { ...h.projects[idx], ...args.data, updatedAt: new Date() };
        return h.projects[idx];
      }),
    },
    task: {
      findFirst: vi.fn(async (args: { where: any }) => {
        return h.tasks.find((t) => {
          if (args.where.id && t.id !== args.where.id) return false;
          if (args.where.projectId && t.projectId !== args.where.projectId) return false;
          if (args.where.organizationId && t.organizationId !== args.where.organizationId) return false;
          return true;
        }) ?? null;
      }),
      findMany: vi.fn(async (args: { where: { projectId?: string } }) => {
        return h.tasks.filter((t) => !args.where.projectId || t.projectId === args.where.projectId);
      }),
      update: vi.fn(async (args: { where: { id: string }; data: any }) => {
        const idx = h.tasks.findIndex((t) => t.id === args.where.id);
        if (idx === -1) throw new Error("Task not found");
        h.tasks[idx] = { ...h.tasks[idx], ...args.data, updatedAt: new Date() };
        return h.tasks[idx];
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const idx = h.tasks.findIndex((t) => t.id === args.where.id);
        if (idx !== -1) h.tasks.splice(idx, 1);
        return {};
      }),
    },
    document: {
      findFirst: vi.fn(async (args: { where: { id: string; organizationId: string } }) => {
        return h.documents.find((d) => d.id === args.where.id && d.organizationId === args.where.organizationId) ?? null;
      }),
    },
    projectActivity: {
      create: vi.fn(async (args: { data: any }) => {
        h.activities.push({
          id: `act_${Date.now()}`,
          projectId: args.data.projectId,
          action: args.data.action,
          createdAt: new Date(),
        });
        return {};
      }),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
      // Execute the callback passing the mocked prisma client
      const { prisma } = await import("@/app/lib/db");
      return cb(prisma);
    }),
  },
}));

import { GET as getProjects } from "@/app/api/projects/route";
import { GET as getSingleProject } from "@/app/api/projects/[id]/route";
import { PATCH as updateProjectTask, DELETE as deleteProjectTask } from "@/app/api/projects/[id]/tasks/[taskId]/route";
import { GET as downloadDocument } from "@/app/api/documents/[id]/download/route";

describe("Project Detail Enhancements", () => {
  const sessionOrgA: Session = {
    userId: "usr_orgA_lead",
    organizationId: "org_a",
    role: "ADMIN",
    email: "lead@orga.com",
    name: "Alice Lead",
  };

  const sessionOrgB: Session = {
    userId: "usr_orgB_lead",
    organizationId: "org_b",
    role: "ADMIN",
    email: "lead@orgb.com",
    name: "Bob Other",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.projects.length = 0;
    h.tasks.length = 0;
    h.documents.length = 0;
    h.reports.length = 0;
    h.insights.length = 0;
    h.activities.length = 0;
  });

  describe("1. Timestamps & Serialization", () => {
    it("serializes actual project updatedAt and createdAt timestamps", async () => {
      h.getSession.mockResolvedValue(sessionOrgA);

      const fixedCreated = new Date("2026-09-01T10:00:00.000Z");
      const fixedUpdated = new Date("2026-10-02T15:30:00.000Z");

      h.projects.push({
        id: "proj_ts",
        organizationId: "org_a",
        ownerId: "usr_orgA_lead",
        name: "Timestamped Project",
        accountName: "Acme",
        status: "ON_TRACK",
        progress: 0,
        openTasksCount: 0,
        dueDate: new Date("2026-11-01T00:00:00.000Z"),
        createdAt: fixedCreated,
        updatedAt: fixedUpdated,
      });

      const res = await getProjects();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.projects).toHaveLength(1);

      const project = data.projects[0];
      expect(project.createdAt).toBe("2026-09-01T10:00:00.000Z");
      expect(project.updatedAt).toBe("2026-10-02T15:30:00.000Z");
    });
  });

  describe("2. Associated Documents and Reports", () => {
    it("surfaces documents and reports with status indicators and secure view/download urls", async () => {
      h.getSession.mockResolvedValue(sessionOrgA);

      const now = new Date("2026-10-01T12:00:00.000Z");

      h.projects.push({
        id: "proj_assets",
        organizationId: "org_a",
        ownerId: "usr_orgA_lead",
        name: "Asset Project",
        accountName: "Acme",
        status: "ON_TRACK",
        progress: 50,
        openTasksCount: 1,
        dueDate: new Date("2026-12-01T00:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
      });

      // Associated documents
      h.documents.push(
        {
          id: "doc_1",
          organizationId: "org_a",
          uploadedById: "usr_orgA_lead",
          projectId: "proj_assets",
          fileName: "sow_agreement.pdf",
          fileSize: "2.4 MB",
          fileUrl: "https://storage.example.com/sow.pdf",
          processingStatus: "PROCESSED",
          extractedEntitiesCount: 14,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "doc_2",
          organizationId: "org_a",
          uploadedById: "usr_orgA_lead",
          projectId: "proj_assets",
          fileName: "notes.txt",
          fileSize: "15 KB",
          fileUrl: "https://storage.example.com/notes.txt",
          processingStatus: "PENDING",
          extractedEntitiesCount: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "doc_3",
          organizationId: "org_a",
          uploadedById: "usr_orgA_lead",
          projectId: "proj_assets",
          fileName: "corrupt.csv",
          fileSize: "500 KB",
          fileUrl: "https://storage.example.com/corrupt.csv",
          processingStatus: "FAILED",
          extractedEntitiesCount: 0,
          failureReason: "CSV header malformed",
          createdAt: now,
          updatedAt: now,
        }
      );

      // Associated report
      h.reports.push({
        id: "rep_1",
        organizationId: "org_a",
        createdById: "usr_orgA_lead",
        projectId: "proj_assets",
        title: "Q4 Business Review",
        type: "QBR Deck",
        accountName: "Acme",
        size: "4.8 MB",
        status: "READY",
        fileUrl: "https://storage.example.com/qbr.pdf",
        createdAt: now,
      });

      const res = await getSingleProject(new Request("http://localhost/api/projects/proj_assets"), {
        params: Promise.resolve({ id: "proj_assets" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const proj = data.project;

      expect(proj.documents).toHaveLength(3);
      expect(proj.documents[0].processingStatus).toBe("PROCESSED");
      expect(proj.documents[0].extractedEntitiesCount).toBe(14);
      expect(proj.documents[1].processingStatus).toBe("PENDING");
      expect(proj.documents[2].processingStatus).toBe("FAILED");
      expect(proj.documents[2].failureReason).toBe("CSV header malformed");

      expect(proj.reports).toHaveLength(1);
      expect(proj.reports[0].title).toBe("Q4 Business Review");
      expect(proj.reports[0].status).toBe("READY");
      expect(proj.reports[0].fileUrl).toBe("https://storage.example.com/qbr.pdf");
    });

    it("handles projects with no related documents or reports gracefully", async () => {
      h.getSession.mockResolvedValue(sessionOrgA);

      h.projects.push({
        id: "proj_empty",
        organizationId: "org_a",
        ownerId: "usr_orgA_lead",
        name: "Empty Project",
        accountName: "Acme",
        status: "ON_TRACK",
        progress: 0,
        openTasksCount: 0,
        dueDate: new Date("2026-12-01T00:00:00.000Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await getSingleProject(new Request("http://localhost/api/projects/proj_empty"), {
        params: Promise.resolve({ id: "proj_empty" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.project.documents).toEqual([]);
      expect(data.project.reports).toEqual([]);
      expect(data.project.insights).toEqual([]);
    });

    it("provides secure document download with tenant verification and presigned urls", async () => {
      h.getSession.mockResolvedValue(sessionOrgA);

      h.documents.push({
        id: "doc_secure_1",
        organizationId: "org_a",
        uploadedById: "usr_orgA_lead",
        projectId: "proj_assets",
        fileName: "financial_report.pdf",
        fileSize: "1.2 MB",
        fileUrl: "https://storage.example.com/financial_report.pdf",
        storageKey: "org_a/docs/financial_report.pdf",
        processingStatus: "PROCESSED",
        extractedEntitiesCount: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 1. Authorized download returns presigned url via JSON format
      const reqJson = new Request("http://localhost/api/documents/doc_secure_1/download?format=json");
      const resJson = await downloadDocument(reqJson, { params: Promise.resolve({ id: "doc_secure_1" }) });
      expect(resJson.status).toBe(200);
      const data = await resJson.json();
      expect(data.downloadUrl).toContain("https://storage.mock.s3/presigned/");
      expect(data.fileName).toBe("financial_report.pdf");

      // 2. Browser request redirects with 302
      const reqRedirect = new Request("http://localhost/api/documents/doc_secure_1/download");
      const resRedirect = await downloadDocument(reqRedirect, { params: Promise.resolve({ id: "doc_secure_1" }) });
      expect(resRedirect.status).toBe(302);
      expect(resRedirect.headers.get("location")).toContain("https://storage.mock.s3/presigned/");

      // 3. Organization B trying to download Org A's document gets 404
      h.getSession.mockResolvedValue(sessionOrgB);
      const resDenied = await downloadDocument(reqJson, { params: Promise.resolve({ id: "doc_secure_1" }) });
      expect(resDenied.status).toBe(404);
    });
  });

  describe("3. Insight Associations & Zero Inference", () => {
    it("surfaces only insights with explicit projectId; never infers by similar name, account name, or task metadata", async () => {
      h.getSession.mockResolvedValue(sessionOrgA);

      h.projects.push({
        id: "proj_sec",
        organizationId: "org_a",
        ownerId: "usr_orgA_lead",
        name: "Enterprise Security Audit",
        accountName: "Acme Corp",
        status: "ON_TRACK",
        progress: 0,
        openTasksCount: 0,
        dueDate: new Date("2026-11-01T00:00:00.000Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 1. Insight with explicit projectId -> MUST be returned
      h.insights.push({
        id: "ins_explicit",
        organizationId: "org_a",
        projectId: "proj_sec",
        type: "RISK",
        severity: "CRITICAL",
        title: "Database Encryption Key Rotation Required",
        body: "Key has expired",
        accountName: "Acme Corp",
        ctaHref: "/insights/ins_explicit",
        ctaLabel: "Rotate Key",
        read: false,
        whatHappened: "Encryption expired",
        whyDetected: "Automated scan",
        chartTitle: "Scan",
        chartType: "bar",
        chartDataJson: "[]",
        businessImpact: "High",
        recommendedAction: "Rotate key immediately",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 2. Insight with identical accountName and similar title but NO projectId -> MUST NOT be returned
      h.insights.push({
        id: "ins_coincidental_name",
        organizationId: "org_a",
        projectId: null,
        type: "RISK",
        severity: "HIGH",
        title: "Enterprise Security Audit Delay Risk",
        body: "Unrelated alert with similar name",
        accountName: "Acme Corp",
        ctaHref: "/insights/ins_coincidental_name",
        ctaLabel: "View",
        read: false,
        whatHappened: "Delayed vendor response",
        whyDetected: "Pattern",
        chartTitle: "Trend",
        chartType: "line",
        chartDataJson: "[]",
        businessImpact: "Medium",
        recommendedAction: "Escalate",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 3. Insight linked to a different project -> MUST NOT be returned
      h.insights.push({
        id: "ins_other_proj",
        organizationId: "org_a",
        projectId: "proj_different",
        type: "OPPORTUNITY",
        severity: "MEDIUM",
        title: "Acme Corp Upsell",
        body: "Different project",
        accountName: "Acme Corp",
        ctaHref: "/insights/ins_other_proj",
        ctaLabel: "View",
        read: false,
        whatHappened: "Usage spike",
        whyDetected: "Usage analytics",
        chartTitle: "Spike",
        chartType: "bar",
        chartDataJson: "[]",
        businessImpact: "Revenue",
        recommendedAction: "Pitch add-on",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await getSingleProject(new Request("http://localhost/api/projects/proj_sec"), {
        params: Promise.resolve({ id: "proj_sec" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const proj = data.project;

      expect(proj.insights).toHaveLength(1);
      expect(proj.insights[0].id).toBe("ins_explicit");
      expect(proj.insights[0].title).toBe("Database Encryption Key Rotation Required");
      expect(proj.insights[0].severity).toBe("CRITICAL");
    });
  });

  describe("4. Task and Project Consistency", () => {
    it("updates project openTasksCount and progress consistently on task status change and deletion", async () => {
      h.getSession.mockResolvedValue(sessionOrgA);

      h.projects.push({
        id: "proj_calc",
        organizationId: "org_a",
        ownerId: "usr_orgA_lead",
        name: "Calculations Test Project",
        accountName: "Beta Corp",
        status: "ON_TRACK",
        progress: 0,
        openTasksCount: 2,
        dueDate: new Date("2026-11-01T00:00:00.000Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      h.tasks.push(
        {
          id: "task_sub_1",
          organizationId: "org_a",
          projectId: "proj_calc",
          title: "Subtask 1",
          status: "TODO",
          dueDate: null,
          assigneeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "task_sub_2",
          organizationId: "org_a",
          projectId: "proj_calc",
          title: "Subtask 2",
          status: "TODO",
          dueDate: null,
          assigneeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        // Project-independent task (must not interfere with proj_calc)
        {
          id: "task_unassigned",
          organizationId: "org_a",
          projectId: null,
          title: "Standalone task",
          status: "TODO",
          dueDate: null,
          assigneeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );

      // 1. Mark task_sub_1 as DONE -> progress should become 50%, openTasksCount = 1
      const patchReq = new Request("http://localhost/api/projects/proj_calc/tasks/task_sub_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });

      const patchRes = await updateProjectTask(patchReq, {
        params: Promise.resolve({ id: "proj_calc", taskId: "task_sub_1" }),
      });

      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.project.progress).toBe(50);
      expect(patchData.project.openTasksCount).toBe(1);

      // 2. Delete task_sub_2 -> only 1 task remaining, which is DONE -> progress should become 100%, openTasksCount = 0
      const delReq = new Request("http://localhost/api/projects/proj_calc/tasks/task_sub_2", {
        method: "DELETE",
      });

      const delRes = await deleteProjectTask(delReq, {
        params: Promise.resolve({ id: "proj_calc", taskId: "task_sub_2" }),
      });

      expect(delRes.status).toBe(200);
      const delData = await delRes.json();
      expect(delData.project.progress).toBe(100);
      expect(delData.project.openTasksCount).toBe(0);

      // 3. Verify standalone task is untouched
      const standalone = h.tasks.find((t) => t.id === "task_unassigned");
      expect(standalone).toBeDefined();
      expect(standalone?.projectId).toBeNull();
    });
  });

  describe("5. Security and Tenant Scoping", () => {
    it("strictly isolates projects between organizations", async () => {
      h.projects.push(
        {
          id: "proj_org_a",
          organizationId: "org_a",
          ownerId: "usr_orgA_lead",
          name: "Org A Project",
          accountName: "Org A Client",
          status: "ON_TRACK",
          progress: 0,
          openTasksCount: 0,
          dueDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "proj_org_b",
          organizationId: "org_b",
          ownerId: "usr_orgB_lead",
          name: "Org B Project",
          accountName: "Org B Client",
          status: "ON_TRACK",
          progress: 0,
          openTasksCount: 0,
          dueDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );

      // Org A queries all projects: should see only Org A project
      h.getSession.mockResolvedValue(sessionOrgA);
      const resA = await getProjects();
      const dataA = await resA.json();
      expect(dataA.projects).toHaveLength(1);
      expect(dataA.projects[0].id).toBe("proj_org_a");

      // Org A tries to access Org B project directly by ID: gets 404
      const resSingle = await getSingleProject(new Request("http://localhost/api/projects/proj_org_b"), {
        params: Promise.resolve({ id: "proj_org_b" }),
      });
      expect(resSingle.status).toBe(404);
    });
  });
});
