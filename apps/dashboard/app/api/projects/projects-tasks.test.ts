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
  projectId: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate: Date | null;
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ActivityRecord {
  id: string;
  organizationId: string;
  projectId: string;
  authorId: string;
  action: string;
  details?: string | null;
  type: string;
  createdAt: Date;
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
    { id: "usr_user1", name: "Jordan Ellis", organizationId: "org_a", avatarInitials: "JE" },
    { id: "usr_user2", name: "Priya Sharma", organizationId: "org_a", avatarInitials: "PS" },
    { id: "usr_other", name: "Other User", organizationId: "org_b", avatarInitials: "OU" },
  ];

  const projects: ProjectRecord[] = [
    {
      id: "proj_1",
      organizationId: "org_a",
      ownerId: "usr_user1",
      name: "Security Audit",
      accountName: "Acme Corp",
      status: "ON_TRACK",
      progress: 0,
      openTasksCount: 0,
      dueDate: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "proj_other",
      organizationId: "org_b",
      ownerId: "usr_other",
      name: "Secret Org B Project",
      accountName: "Org B Corp",
      status: "ON_TRACK",
      progress: 0,
      openTasksCount: 0,
      dueDate: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const tasks: TaskRecord[] = [
    {
      id: "task_1",
      organizationId: "org_a",
      projectId: "proj_1",
      title: "Draft SOW",
      status: "TODO",
      dueDate: new Date("2026-09-25T00:00:00Z"),
      assigneeId: "usr_user1",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const activities: ActivityRecord[] = [];

  const getSession = vi.fn<() => Promise<Session | null>>();

  return { users, projects, tasks, activities, getSession };
});

vi.mock("@/app/lib/session", () => ({ getSession: h.getSession }));
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
          activities: h.activities
            .filter((a) => a.projectId === p.id)
            .map((a) => ({ ...a, author: h.users.find((u) => u.id === a.authorId)! })),
        }));
      }),
      findFirst: vi.fn(async (args: { where: { id: string; organizationId: string } }) =>
        h.projects.find((p) => p.id === args.where.id && p.organizationId === args.where.organizationId) ?? null
      ),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const p = h.projects.find((proj) => proj.id === args.where.id);
        if (!p) return null;
        return {
          ...p,
          owner: h.users.find((u) => u.id === p.ownerId)!,
          tasks: h.tasks
            .filter((t) => t.projectId === p.id)
            .map((t) => ({ ...t, assignee: h.users.find((u) => u.id === t.assigneeId) ?? null })),
          activities: h.activities
            .filter((a) => a.projectId === p.id)
            .map((a) => ({ ...a, author: h.users.find((u) => u.id === a.authorId)! })),
        };
      }),
      create: vi.fn(async (args: any) => {
        const newProj: ProjectRecord = {
          id: `proj_${Date.now()}`,
          organizationId: args.data.organizationId,
          ownerId: args.data.ownerId,
          name: args.data.name,
          accountName: args.data.accountName,
          status: args.data.status,
          dueDate: args.data.dueDate,
          progress: args.data.progress ?? 0,
          openTasksCount: args.data.openTasksCount ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        h.projects.push(newProj);

        if (args.data.tasks?.create) {
          for (const t of args.data.tasks.create) {
            h.tasks.push({
              id: `task_${Date.now()}_${Math.random()}`,
              organizationId: t.organizationId,
              projectId: newProj.id,
              title: t.title,
              status: t.status,
              dueDate: t.dueDate ?? null,
              assigneeId: t.assigneeId ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }

        if (args.data.activities?.create) {
          const act = args.data.activities.create;
          h.activities.push({
            id: `act_${Date.now()}`,
            organizationId: act.organizationId,
            projectId: newProj.id,
            authorId: act.authorId,
            action: act.action,
            details: act.details ?? null,
            type: act.type,
            createdAt: new Date(),
          });
        }

        return {
          ...newProj,
          owner: h.users.find((u) => u.id === newProj.ownerId)!,
          tasks: h.tasks
            .filter((t) => t.projectId === newProj.id)
            .map((t) => ({ ...t, assignee: h.users.find((u) => u.id === t.assigneeId) ?? null })),
          activities: h.activities
            .filter((a) => a.projectId === newProj.id)
            .map((a) => ({ ...a, author: h.users.find((u) => u.id === a.authorId)! })),
        };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: any }) => {
        const p = h.projects.find((proj) => proj.id === args.where.id)!;
        Object.assign(p, args.data, { updatedAt: new Date() });
        return p;
      }),
    },
    task: {
      findFirst: vi.fn(
        async (args: { where: { id: string; projectId?: string; organizationId: string } }) =>
          h.tasks.find(
            (t) =>
              t.id === args.where.id &&
              (args.where.projectId ? t.projectId === args.where.projectId : true) &&
              t.organizationId === args.where.organizationId
          ) ?? null
      ),
      findMany: vi.fn(async (args: { where: { projectId: string } }) =>
        h.tasks.filter((t) => t.projectId === args.where.projectId)
      ),
      create: vi.fn(async (args: { data: any }) => {
        const newTask: TaskRecord = {
          id: `task_${Date.now()}`,
          organizationId: args.data.organizationId,
          projectId: args.data.projectId,
          title: args.data.title,
          status: args.data.status ?? "TODO",
          dueDate: args.data.dueDate ?? null,
          assigneeId: args.data.assigneeId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        h.tasks.push(newTask);
        return newTask;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: any }) => {
        const t = h.tasks.find((task) => task.id === args.where.id)!;
        Object.assign(t, args.data, { updatedAt: new Date() });
        return t;
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const idx = h.tasks.findIndex((t) => t.id === args.where.id);
        if (idx !== -1) h.tasks.splice(idx, 1);
        return {};
      }),
    },
    projectActivity: {
      create: vi.fn(async (args: { data: any }) => {
        const act: ActivityRecord = {
          id: `act_${Date.now()}`,
          organizationId: args.data.organizationId,
          projectId: args.data.projectId,
          authorId: args.data.authorId,
          action: args.data.action,
          details: args.data.details ?? null,
          type: args.data.type,
          createdAt: new Date(),
        };
        h.activities.push(act);
        return act;
      }),
    },
    $transaction: vi.fn(async (cb: any) => {
      // Transaction wrapper calling the mocked prisma client directly
      const mockTx = {
        project: (await import("@/app/lib/db")).prisma.project,
        task: (await import("@/app/lib/db")).prisma.task,
        projectActivity: (await import("@/app/lib/db")).prisma.projectActivity,
      };
      return cb(mockTx);
    }),
  },
}));

import { POST as createProject } from "./route";
import { PATCH as updateProject } from "./[id]/route";
import { POST as addTask } from "./[id]/tasks/route";
import { PATCH as updateTask, DELETE as deleteTask } from "./[id]/tasks/[taskId]/route";

function sessionOrgA(): Session {
  return { mode: "CLIENT", userId: "usr_user1", organizationId: "org_a", name: "Jordan Ellis", email: "jordan@acme.com", role: "ADMIN" };
}

function sessionOrgB(): Session {
  return { mode: "CLIENT", userId: "usr_other", organizationId: "org_b", name: "Other User", email: "other@orgb.com", role: "MEMBER" };
}

describe("Projects & Subtasks API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/projects (Create with Subtasks)", () => {
    it("creates a project with initial subtasks and logs activity", async () => {
      h.getSession.mockResolvedValueOnce(sessionOrgA());

      const req = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Q4 Marketing Campaign",
          accountName: "Acme Corp",
          ownerId: "usr_user1",
          status: "ON_TRACK",
          dueDate: "2026-11-01T00:00:00.000Z",
          tasks: [
            { title: "Draft Copy", assigneeId: "usr_user1" },
            { title: "Design Assets", assigneeId: "usr_user2" },
          ],
        }),
      });

      const res = await createProject(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.project.name).toBe("Q4 Marketing Campaign");
      expect(json.project.tasks).toHaveLength(2);
      expect(json.project.openTasksCount).toBe(2);
      expect(json.project.progress).toBe(0);
      expect(json.project.activities.some((a: any) => a.action === "Created new project")).toBe(true);
    });
  });

  describe("PATCH /api/projects/:id (Edit Project)", () => {
    it("updates project details and logs activity", async () => {
      h.getSession.mockResolvedValueOnce(sessionOrgA());

      const req = new Request("http://localhost/api/projects/proj_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "AT_RISK", name: "Updated Security Audit" }),
      });

      const res = await updateProject(req, { params: Promise.resolve({ id: "proj_1" }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.project.name).toBe("Updated Security Audit");
      expect(json.project.status).toBe("AT_RISK");
      expect(json.project.activities.some((a: any) => a.action === "Updated project details")).toBe(true);
    });

    it("rejects project edit from another organization (404 / org scoping)", async () => {
      h.getSession.mockResolvedValueOnce(sessionOrgB());

      const req = new Request("http://localhost/api/projects/proj_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Hacked Title" }),
      });

      const res = await updateProject(req, { params: Promise.resolve({ id: "proj_1" }) });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/projects/:id/tasks (Add Subtask)", () => {
    it("adds a subtask to an existing project", async () => {
      h.getSession.mockResolvedValueOnce(sessionOrgA());

      const req = new Request("http://localhost/api/projects/proj_1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Verify Staging", assigneeId: "usr_user2" }),
      });

      const res = await addTask(req, { params: Promise.resolve({ id: "proj_1" }) });
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.project.tasks.some((t: any) => t.title === "Verify Staging")).toBe(true);
      expect(json.project.activities.some((a: any) => a.action.includes("Added task: Verify Staging"))).toBe(true);
    });
  });

  describe("PATCH & DELETE /api/projects/:id/tasks/:taskId", () => {
    it("toggles task completion status, recalculates progress, and logs activity", async () => {
      h.getSession.mockResolvedValueOnce(sessionOrgA());

      const req = new Request("http://localhost/api/projects/proj_1/tasks/task_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });

      const res = await updateTask(req, { params: Promise.resolve({ id: "proj_1", taskId: "task_1" }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.project.progress).toBe(50);
      expect(json.project.activities.some((a: any) => a.action.includes("Marked 'Draft SOW' complete"))).toBe(true);
    });

    it("deletes a subtask and recalculates progress", async () => {
      h.getSession.mockResolvedValueOnce(sessionOrgA());

      const req = new Request("http://localhost/api/projects/proj_1/tasks/task_1", {
        method: "DELETE",
      });

      const res = await deleteTask(req, { params: Promise.resolve({ id: "proj_1", taskId: "task_1" }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.project.tasks.find((t: any) => t.id === "task_1")).toBeUndefined();
      expect(json.project.activities.some((a: any) => a.action.includes("Deleted task 'Draft SOW'"))).toBe(true);
    });

    it("prevents another org from toggling task status (404)", async () => {
      h.getSession.mockResolvedValueOnce(sessionOrgB());

      const req = new Request("http://localhost/api/projects/proj_1/tasks/task_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });

      const res = await updateTask(req, { params: Promise.resolve({ id: "proj_1", taskId: "task_1" }) });
      expect(res.status).toBe(404);
    });
  });
});
