-- Inbound messaging bridge: per-organization channel inboxes + webhook idempotency.

-- Provider-issued message id so WhatsApp (and later email) retries do not
-- append the same body twice.
ALTER TABLE "customer_messages" ADD COLUMN "providerMessageId" TEXT;

CREATE UNIQUE INDEX "customer_messages_organizationId_providerMessageId_key"
  ON "customer_messages"("organizationId", "providerMessageId");

-- Lookup indexes for identifying an inbound contact inside one tenant.
CREATE INDEX "customers_organizationId_phone_idx" ON "customers"("organizationId", "phone");

CREATE UNIQUE INDEX "customers_organizationId_whatsapp_key"
  ON "customers"("organizationId", "whatsapp");

-- Routing table: (provider, externalAddress) → organizationId.
-- WhatsApp: externalAddress is Meta Cloud API phone_number_id.
-- Email (future): externalAddress is the inbound mailbox, lowercased.
CREATE TABLE "messaging_inboxes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAddress" TEXT NOT NULL,
    "displayLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_inboxes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "messaging_inboxes_provider_externalAddress_key"
  ON "messaging_inboxes"("provider", "externalAddress");

CREATE INDEX "messaging_inboxes_organizationId_provider_idx"
  ON "messaging_inboxes"("organizationId", "provider");

ALTER TABLE "messaging_inboxes"
  ADD CONSTRAINT "messaging_inboxes_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE messaging_inboxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON messaging_inboxes
  FOR ALL
  USING ("organizationId" = current_app_org_id())
  WITH CHECK ("organizationId" = current_app_org_id());

-- Webhooks resolve the tenant by inbox address before the organization id is
-- known, so SELECT must succeed without app.current_organization_id. These
-- rows only store the public channel address, not message bodies.
CREATE POLICY inbox_routing_lookup ON messaging_inboxes
  FOR SELECT
  USING (true);
