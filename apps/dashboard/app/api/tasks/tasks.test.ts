import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const invalidateDashboardCache = vi.fn();
  const notifyOrgDataChanged = vi.fn();

  // In-memory mock store
  let mockTasks: any[] = [];
  let mockProjects: any[] = [];
  let mockInsights: any[] = [];
  let mockInsightActions: any[] = [];
  let mockActivities: any[] = [];

  const resetStore = () => {
    mockTasks = [
      {
        id: "task_proj_1",
        organizationId: "org_tenant_1",
        projectId: "proj_1",
        assigneeId: "user_1",
        title: "Setup API routes",
        description: "[priority:HIGH] Initialize REST endpoints",
        status: "TODO",
        dueDate: new Date("2026-10-15T00:00:00Z"),
        createdAt: new Date("2026-10-01T10:00:00Z"),
        updatedAt: new Date("2026-10-01T10:00:00Z"),
        project: { id: "proj_1", name: "Core Platform", accountName: "Acme Corp" },
        assignee: { id: "user_1", name: "Alice Admin", avatarInitials: "AA" },
      },
      {
        id: "task_indep_1",
        organizationId: "org_tenant_1",
        projectId: null,
        assigneeId: "user_1",
        title: "[Insight] High API Error Rate",
        description: "[insightId:ins_1][priority:HIGH] Investigate logs and increase timeouts",
        status: "TODO",
        dueDate: null,
        createdAt: new Date("2026-10-02T08:00:00Z"),
        updatedAt: new Date("2026-10-02T08:00:00Z"),
        project: null,
        assignee: { id: "user_1", name: "Alice Admin", avatarInitials: "AA" },
      },
      {
        id: "task_tenant_2",
        organizationId: "org_tenant_2",
        projectId: null,
        assigneeId: "user_2",
        title: "Tenant 2 secret task",
        description: "Confidential",
        status: "TODO",
        dueDate: null,
        createdAt: new Date("2026-10-02T09:00:00Z"),
        updatedAt: new Date("2026-10-02T09:00:00Z"),
        project: null,
        assignee: null,
      },
    ];

    mockProjects = [
      {
        id: "proj_1",
        organizationId: "org_tenant_1",
        name: "Core Platform",
        accountName: "Acme Corp",
        openTasksCount: 1,
        progress: 0,
      },
      {
        id: "proj_other_org",
        organizationId: "org_tenant_2",
        name: "Other Org Project",
        accountName: "Beta Corp",
        openTasksCount: 0,
        progress: 0,
      },
    ];

    mockInsights = [
      {
        id: "ins_1",
        organizationId: "org_tenant_1",
        title: "High API Error Rate",
        type: "RISK",
        severity: "CRITICAL",
        recommendedAction: "Investigate logs and increase timeouts",
        read: false,
      },
    ];

    mockInsightActions = [];
    mockActivities = [];
  };

  const tasksFindMany = vi.fn(async (args: any) => {
    let result = mockTasks.filter((t) => t.organizationId === args.where.organizationId);
    if (args.where.projectId === null) {
      result = result.filter((t) => t.projectId === null);
    } else if (args.where.projectId) {
      result = result.filter((t) => t.projectId === args.where.projectId);
    }
    if (args.where.status?.not === "DONE") {
      result = result.filter((t) => t.status !== "DONE");
    } else if (args.where.status && typeof args.where.status === "string") {
      result = result.filter((t) => t.status === args.where.status);
    }
    return result;
  });

  const tasksFindFirst = vi.fn(async (args: any) => {
    const list = mockTasks.filter((t) => {
      if (args.where.organizationId && t.organizationId !== args.where.organizationId) return false;
      if (args.where.id && t.id !== args.where.id) return false;
      if (args.where.OR) {
        return args.where.OR.some((cond: any) => {
          if (cond.title && t.title === cond.title) return true;
          if (cond.description?.contains && t.description?.includes(cond.description.contains)) return true;
          return false;
        });
      }
      return true;
    });
    return list[0] || null;
  });

  const taskCreate = vi.fn(async (args: any) => {
    const created = {
      id: `task_${Date.now()}_${Math.random()}`,
      ...args.data,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: args.data.projectId ? mockProjects.find((p) => p.id === args.data.projectId) || null : null,
      assignee: null,
    };
    mockTasks.push(created);
    return created;
  });

  const taskUpdate = vi.fn(async (args: any) => {
    const idx = mockTasks.findIndex((t) => t.id === args.where.id);
    if (idx !== -1) {
      mockTasks[idx] = { ...mockTasks[idx], ...args.data, updatedAt: new Date() };
      return mockTasks[idx];
    }
    throw new Error("Task not found");
  });

  const taskDelete = vi.fn(async (args: any) => {
    mockTasks = mockTasks.filter((t) => t.id !== args.where.id);
    return { id: args.where.id };
  });

  const projectFindFirst = vi.fn(async (args: any) => {
    return mockProjects.find(
      (p) => p.id === args.where.id && (!args.where.organizationId || p.organizationId === args.where.organizationId)
    ) || null;
  });

  const projectUpdate = vi.fn(async (args: any) => {
    const proj = mockProjects.find((p) => p.id === args.where.id);
    if (proj) Object.assign(proj, args.data);
    return proj;
  });

  const insightFindFirst = vi.fn(async (args: any) => {
    return mockInsights.find(
      (i) => i.id === args.where.id && (!args.where.organizationId || i.organizationId === args.where.organizationId)
    ) || null;
  });

  const insightFindMany = vi.fn(async (args: any) => {
    return mockInsights.filter(
      (i) => i.organizationId === args.where.organizationId && (!args.where.id?.in || args.where.id.in.includes(i.id))
    );
  });

  const insightUpdate = vi.fn(async (args: any) => {
    const ins = mockInsights.find((i) => i.id === args.where.id);
    if (ins) Object.assign(ins, args.data);
    return ins;
  });

  const insightActionCreate = vi.fn(async (args: any) => {
    mockInsightActions.push(args.data);
    return args.data;
  });

  const projectActivityCreate = vi.fn(async (args: any) => {
    mockActivities.push(args.data);
    return args.data;
  });

  const userFindFirst = vi.fn(async () => ({ id: "user_1" }));

  const transaction = vi.fn(async (fn: any) => {
    return fn({
      task: {
        create: taskCreate,
        update: taskUpdate,
        delete: taskDelete,
        findMany: tasksFindMany,
        findFirst: tasksFindFirst,
      },
      project: {
        update: projectUpdate,
        findFirst: projectFindFirst,
      },
      projectActivity: {
        create: projectActivityCreate,
      },
      insight: {
        update: insightUpdate,
      },
      insightAction: {
        create: insightActionCreate,
      },
    });
  });

  return {
    getSession,
    invalidateDashboardCache,
    notifyOrgDataChanged,
    resetStore,
    tasksFindMany,
    tasksFindFirst,
    taskCreate,
    taskUpdate,
    taskDelete,
    projectFindFirst,
    projectUpdate,
    insightFindFirst,
    insightFindMany,
    insightUpdate,
    insightActionCreate,
    projectActivityCreate,
    userFindFirst,
    transaction,
  };
});

vi.mock("@/app/lib/session", () => ({
  getSession: h.getSession,
}));

vi.mock("@/app/api/dashboard/route", () => ({
  invalidateDashboardCache: h.invalidateDashboardCache,
}));

vi.mock("@/app/lib/data-sync", () => ({
  notifyOrgDataChanged: h.notifyOrgDataChanged,
}));

vi.mock("@/app/lib/db", () => ({
  prisma: {
    task: {
      findMany: h.tasksFindMany,
      findFirst: h.tasksFindFirst,
      create: h.taskCreate,
      update: h.taskUpdate,
      delete: h.taskDelete,
    },
    project: {
      findFirst: h.projectFindFirst,
      update: h.projectUpdate,
    },
    insight: {
      findFirst: h.insightFindFirst,
      findMany: h.insightFindMany,
      update: h.insightUpdate,
    },
    insightAction: {
      create: h.insightActionCreate,
    },
    projectActivity: {
      create: h.projectActivityCreate,
    },
    user: {
      findFirst: h.userFindFirst,
    },
    $transaction: h.transaction,
  },
}));

import { GET as getTasks, POST as createTask } from "./route";
import { PATCH as updateTask, DELETE as deleteTask } from "./[id]/route";

describe("Tasks & Actions API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.resetStore();
  });

  describe("GET /api/tasks", () => {
    it("returns 401 when caller is unauthenticated", async () => {
      h.getSession.mockResolvedValueOnce(null);

      const res = await getTasks(new Request("http://localhost:3000/api/tasks"));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("enforces tenant isolation and never returns tasks of other organizations", async () => {
      h.getSession.mockResolvedValueOnce({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const res = await getTasks(new Request("http://localhost:3000/api/tasks"));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.tasks).toHaveLength(2);
      expect(json.tasks.map((t: any) => t.id)).not.toContain("task_tenant_2");
    });

    it("makes insight-created project-independent tasks discoverable with source insight linkage", async () => {
      h.getSession.mockResolvedValueOnce({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const res = await getTasks(new Request("http://localhost:3000/api/tasks"));
      expect(res.status).toBe(200);
      const json = await res.json();

      const insightTask = json.tasks.find((t: any) => t.id === "task_indep_1");
      expect(insightTask).toBeDefined();
      expect(insightTask.projectId).toBeNull();
      expect(insightTask.project).toBeNull();
      expect(insightTask.cleanTitle).toBe("High API Error Rate");
      expect(insightTask.priority).toBe("HIGH");
      expect(insightTask.sourceInsight).toEqual({
        id: "ins_1",
        title: "High API Error Rate",
        type: "RISK",
        severity: "CRITICAL",
      });
    });

    it("supports filtering by project-independent tasks (projectId=none)", async () => {
      h.getSession.mockResolvedValueOnce({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const res = await getTasks(new Request("http://localhost:3000/api/tasks?projectId=none"));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.tasks).toHaveLength(1);
      expect(json.tasks[0].id).toBe("task_indep_1");
      expect(json.tasks[0].projectId).toBeNull();
    });
  });

  describe("POST /api/tasks", () => {
    it("creates a project-independent task and invalidates dashboard cache", async () => {
      h.getSession.mockResolvedValueOnce({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const body = {
        title: "Review security policies",
        description: "Annual SOC2 compliance review",
        priority: "HIGH",
      };

      const res = await createTask(new Request("http://localhost:3000/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.task.title).toBe("Review security policies");
      expect(json.task.projectId).toBeNull();
      expect(json.task.priority).toBe("HIGH");

      // Verify dashboard cache invalidation was triggered
      expect(h.invalidateDashboardCache).toHaveBeenCalledWith("org_tenant_1");
    });

    it("prevents duplicate task creation for the same insight", async () => {
      h.getSession.mockResolvedValue({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const body = {
        title: "High API Error Rate",
        insightId: "ins_1",
      };

      const res = await createTask(new Request("http://localhost:3000/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.alreadyExisted).toBe(true);
      expect(json.task.id).toBe("task_indep_1");
      expect(json.message).toContain("already exists");
    });

    it("rejects linking a task to a project belonging to another organization", async () => {
      h.getSession.mockResolvedValueOnce({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const body = {
        title: "Sneak into other org project",
        projectId: "proj_other_org",
      };

      const res = await createTask(new Request("http://localhost:3000/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain("Project not found");
    });
  });

  describe("PATCH /api/tasks/:id", () => {
    it("updates task status to DONE, recomputes project metrics, and invalidates dashboard cache", async () => {
      h.getSession.mockResolvedValueOnce({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const res = await updateTask(
        new Request("http://localhost:3000/api/tasks/task_proj_1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "DONE" }),
        }),
        { params: Promise.resolve({ id: "task_proj_1" }) }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.task.status).toBe("DONE");

      // Verify project metrics update was called
      expect(h.projectUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proj_1" },
        })
      );

      // Verify dashboard cache invalidation was triggered
      expect(h.invalidateDashboardCache).toHaveBeenCalledWith("org_tenant_1");
    });

    it("returns 404 when attempting to update a task belonging to another organization", async () => {
      h.getSession.mockResolvedValueOnce({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const res = await updateTask(
        new Request("http://localhost:3000/api/tasks/task_tenant_2", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "DONE" }),
        }),
        { params: Promise.resolve({ id: "task_tenant_2" }) }
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Task not found");
    });
  });

  describe("DELETE /api/tasks/:id", () => {
    it("deletes a task and invalidates dashboard cache", async () => {
      h.getSession.mockResolvedValueOnce({
        userId: "user_1",
        organizationId: "org_tenant_1",
        role: "ADMIN",
      });

      const res = await deleteTask(
        new Request("http://localhost:3000/api/tasks/task_indep_1", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "task_indep_1" }) }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify dashboard cache invalidation
      expect(h.invalidateDashboardCache).toHaveBeenCalledWith("org_tenant_1");
    });
  });
});
