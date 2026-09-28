import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const isDev = process.env.NODE_ENV === "development";
  const isProd = process.env.NODE_ENV === "production";

  /*
   * Two applications share this package and must not share a credential.
   *
   *   apps/dashboard  -> DATABASE_URL      (tenant-scoped; must NOT bypass RLS)
   *   apps/admin      -> ADMIN_DATABASE_URL (cross-tenant rf_admin_app role; BYPASSRLS)
   *
   * The admin app sets RF_APP=admin, which selects ADMIN_DATABASE_URL. Falling
   * back to DATABASE_URL in that case is deliberately a loud error rather than a
   * silent default: if the admin project were ever configured with only
   * DATABASE_URL set, quietly borrowing it would give the console the tenant
   * credential and turn every cross-tenant query into an empty result — or, far
   * worse, hand the tenant credential to a BYPASSRLS-expecting code path.
   */
  const isAdminApp = process.env.RF_APP === "admin";
  let rawUrl: string | undefined;
  if (isAdminApp) {
    rawUrl = process.env.ADMIN_DATABASE_URL;
    if (!rawUrl) {
      throw new Error(
        "ADMIN_DATABASE_URL is not set. apps/admin must connect with the dedicated rf_admin_app role; " +
          "it must never fall back to DATABASE_URL.",
      );
    }
  } else {
    // In production, ignore DATABASE_URL_LOCAL and always use the production DATABASE_URL
    rawUrl = !isProd && process.env.DATABASE_URL_LOCAL
      ? process.env.DATABASE_URL_LOCAL
      : process.env.DATABASE_URL;
  }

  let databaseUrl = rawUrl;
  if (databaseUrl && !databaseUrl.startsWith("file:")) {
    try {
      const u = new URL(databaseUrl);
      // On port 6543 (PgBouncer transaction mode), pgbouncer=true tells Prisma not to reuse prepared statements across transactions.
      if (!u.searchParams.has("pgbouncer") && u.port === "6543") {
        u.searchParams.set("pgbouncer", "true");
      }

      // Session-scoped poolers (pgbouncer "session" mode, or any pooler in
      // transaction mode) cannot support SET, so any connection relying on a GUC
      // such as app.current_organization_id needs a direct connection. The admin
      // role bypasses RLS and must not be routed through a pooler at all.
      if (isAdminApp && (u.port === "6543" || u.searchParams.get("pgbouncer") === "true")) {
        throw new Error(
          "ADMIN_DATABASE_URL must point at the direct database port (not 6543 / pgbouncer=true). " +
            "The admin role bypasses RLS, and the tenant context relies on session GUCs that a " +
            "transaction-mode pooler will not preserve.",
        );
      }

      // Maintain a sensible connection pool size (10 in dev, 20 in prod) so concurrent
      // requests in Next.js do not block on connection pool acquisition.
      if (!u.searchParams.has("connection_limit")) {
        u.searchParams.set("connection_limit", isDev ? "10" : "20");
      }
      if (!u.searchParams.has("pool_timeout")) {
        u.searchParams.set("pool_timeout", "30");
      }
      if (!u.searchParams.has("connect_timeout")) {
        u.searchParams.set("connect_timeout", "30");
      }
      databaseUrl = u.toString();
    } catch {
      // Keep rawUrl if URL parsing fails
    }
  }

  const debugQueries = process.env.DEBUG_PRISMA_QUERIES === "true";

  const client = new PrismaClient({
    datasourceUrl: databaseUrl,
    log: debugQueries
      ? [
          { emit: "event", level: "query" },
          { emit: "stdout", level: "warn" },
          { emit: "stdout", level: "error" },
        ]
      : [
          { emit: "stdout", level: "warn" },
          { emit: "stdout", level: "error" },
        ],
  });

  if (debugQueries) {
    // Event-based query logging with durations, enabled only when DEBUG_PRISMA_QUERIES=true
    (client as any).$on("query", (e: any) => {
      console.log(`[PRISMA QUERY] ${e.query.slice(0, 100)}... duration: ${e.duration}ms`);
    });
  }

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient, Prisma } from "@prisma/client";

// Named model type exports — avoids "unexpected export *" Turbopack warning
// for CJS interop with @prisma/client.
export type {
  Organization,
  User,
  Project,
  ProjectActivity,
  Insight,
  InsightAction,
  Task,
  Document,
  Report,
  Conversation,
  Message,
  Notification,
  NotificationPreference,
  AskRfQuery,
  AuditLog,
  Invitation,
  InventoryCategory,
  InventoryLocation,
  InventoryItem,
  InventoryBatch,
  InventoryStockLevel,
  InventoryMovement,
  Supplier,
  PurchaseOrder,
  PurchaseOrderItem,
  Customer,
  CustomerConversation,
  CustomerMessage,
  RfAdminUser,
  OrganizationSettings,
  Plan,
  Subscription,
  AdminAuditLog,
  PrismaPromise,
} from "@prisma/client";
export {
  Role,
  ProjectStatus,
  InsightType,
  InsightSeverity,
  InsightActionStatus,
  TaskStatus,
  DocumentProcessingStatus,
  ReportStatus,
  InvitationStatus,
  InventoryUnit,
  InventoryMovementType,
  PurchaseOrderStatus,
  CustomerStatus,
  CustomerConversationChannel,
  CustomerConversationStatus,
  CustomerConversationPriority,
  CustomerMessageSender,
  BillingInterval,
  SubscriptionStatus,
} from "@prisma/client";

/**
 * Introspects the role this process is connected as, and whether it bypasses
 * Row Level Security.
 *
 * This exists so each app can assert, in code, that it holds the credential it
 * is supposed to hold — the two failure modes here are silent and dangerous:
 *
 *   • apps/admin accidentally given the dashboard's credential would be subject
 *     to the tenant policies and see zero rows for every cross-tenant query.
 *   • apps/dashboard accidentally given the admin's credential would silently
 *     see every tenant's data, breaking tenant isolation with no error.
 *
 * Both apps call this on their first request; the result is cached per process
 * because the answer cannot change while the process is alive.
 */
export interface DatabaseRoleInfo {
  currentUser: string;
  bypassRls: boolean;
  isSuperuser: boolean;
}

let roleInfoPromise: Promise<DatabaseRoleInfo> | null = null;

export async function getDatabaseRoleInfo(): Promise<DatabaseRoleInfo> {
  roleInfoPromise ??= prisma
    .$queryRaw<{ currentUser: string; bypassRls: boolean; isSuperuser: boolean }[]>`
      SELECT
        current_user                                          AS "currentUser",
        COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS "bypassRls",
        COALESCE((SELECT rolsuper    FROM pg_roles WHERE rolname = current_user), false) AS "isSuperuser"
    `
    .then((rows) => rows[0])
    .then((row) => {
      if (!row) throw new Error("Could not determine the current database role");
      return row;
    })
    .catch((err) => {
      // Do not cache a failure — a transient DB blip must not permanently
      // disable the assertion for the life of the process.
      roleInfoPromise = null;
      throw err;
    });
  return roleInfoPromise;
}

/** Test seam: clears the cached role introspection. */
export function resetDatabaseRoleInfoCache(): void {
  roleInfoPromise = null;
}
