-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('LEAD', 'ACTIVE', 'AT_RISK', 'CHURNED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CustomerConversationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'WEB_CHAT', 'SMS');

-- CreateEnum
CREATE TYPE "CustomerConversationStatus" AS ENUM ('OPEN', 'AI_HANDLING', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_CLIENT', 'HUMAN_ESCALATION', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CustomerConversationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CustomerMessageSender" AS ENUM ('CUSTOMER', 'AI', 'EMPLOYEE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'CLIENT_ADMIN';
ALTER TYPE "Role" ADD VALUE 'CLIENT_EMPLOYEE';

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'LEAD',
    "tagsJson" TEXT NOT NULL,
    "internalNotes" TEXT,
    "orderReference" TEXT,
    "assignedEmployeeId" TEXT,
    "lastInteractionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "CustomerConversationChannel" NOT NULL,
    "status" "CustomerConversationStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "CustomerConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "subject" TEXT,
    "tagsJson" TEXT NOT NULL,
    "assignedEmployeeId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "escalationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "CustomerMessageSender" NOT NULL,
    "body" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rf_admin_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rf_admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_organizationId_status_idx" ON "customers"("organizationId", "status");

-- CreateIndex
CREATE INDEX "customers_organizationId_assignedEmployeeId_idx" ON "customers"("organizationId", "assignedEmployeeId");

-- CreateIndex
CREATE INDEX "customers_organizationId_lastInteractionAt_idx" ON "customers"("organizationId", "lastInteractionAt");

-- CreateIndex
CREATE INDEX "customers_organizationId_email_idx" ON "customers"("organizationId", "email");

-- CreateIndex
CREATE INDEX "customer_conversations_organizationId_status_idx" ON "customer_conversations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "customer_conversations_organizationId_channel_idx" ON "customer_conversations"("organizationId", "channel");

-- CreateIndex
CREATE INDEX "customer_conversations_organizationId_customerId_idx" ON "customer_conversations"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "customer_conversations_organizationId_assignedEmployeeId_idx" ON "customer_conversations"("organizationId", "assignedEmployeeId");

-- CreateIndex
CREATE INDEX "customer_conversations_organizationId_lastMessageAt_idx" ON "customer_conversations"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "customer_messages_conversationId_createdAt_idx" ON "customer_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_messages_organizationId_createdAt_idx" ON "customer_messages"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "rf_admin_users_email_key" ON "rf_admin_users"("email");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_conversations" ADD CONSTRAINT "customer_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_conversations" ADD CONSTRAINT "customer_conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_conversations" ADD CONSTRAINT "customer_conversations_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_messages" ADD CONSTRAINT "customer_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_messages" ADD CONSTRAINT "customer_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "customer_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Follows the same organization-scoped approach as 20260911_enable_rls: the
-- tenant is carried in a session GUC (`app.current_organization_id`) and read
-- through the `current_app_org_id()` helper defined there.
--
-- Two deliberate differences from 20260911:
--
--   1. These policies reference the real column name, "organizationId".
--      20260911_enable_rls was written against `organization_id`, but no model
--      in this schema uses @map, so that column has never existed. That
--      migration cannot have been applied as written.
--
--   2. `rf_admin_users` is intentionally left WITHOUT a policy. It carries no
--      organizationId because RF admins are not tenant-scoped — they span every
--      organization. Enabling tenant RLS on it would be incorrect, not just
--      redundant. It is reachable only through the rf_admin_session cookie,
--      which is minted solely by POST /api/auth/rf-admin/login.
--
-- Note for whoever wires this up: the app connects through PgBouncer in
-- transaction mode (:6543), so the GUC must be set transaction-locally
-- (set_config(..., true) inside a transaction), never as a bare session SET.
-- Table owners also bypass RLS unless FORCE ROW LEVEL SECURITY is applied, so
-- RLS alone is not sufficient isolation — every query must still filter on
-- organizationId in application code.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on customers
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON customers
  FOR ALL
  USING ("organizationId" = current_app_org_id())
  WITH CHECK ("organizationId" = current_app_org_id());

-- Enable RLS on customer_conversations
ALTER TABLE customer_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON customer_conversations
  FOR ALL
  USING ("organizationId" = current_app_org_id())
  WITH CHECK ("organizationId" = current_app_org_id());

-- Enable RLS on customer_messages
ALTER TABLE customer_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON customer_messages
  FOR ALL
  USING ("organizationId" = current_app_org_id())
  WITH CHECK ("organizationId" = current_app_org_id());
