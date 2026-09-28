import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const isDev = process.env.NODE_ENV === "development";
  const isProd = process.env.NODE_ENV === "production";

  // In production, ignore DATABASE_URL_LOCAL and always use the production DATABASE_URL
  let rawUrl = (!isProd && process.env.DATABASE_URL_LOCAL) ? process.env.DATABASE_URL_LOCAL : process.env.DATABASE_URL;

  let databaseUrl = rawUrl;
  if (databaseUrl && !databaseUrl.startsWith("file:")) {
    try {
      const u = new URL(databaseUrl);
      // On port 6543 (PgBouncer transaction mode), pgbouncer=true tells Prisma not to reuse prepared statements across transactions.
      if (!u.searchParams.has("pgbouncer") && u.port === "6543") {
        u.searchParams.set("pgbouncer", "true");
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
} from "@prisma/client";
