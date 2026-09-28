-- ═════════════════════════════════════════════════════════════════════════════
-- RF Admin console — dedicated database role
-- ═════════════════════════════════════════════════════════════════════════════
-- Run as a superuser or a role with CREATEROLE on the target database, ONCE per
-- environment. The role is shared by every apps/admin deployment for that
-- database; the *password* lives only in the admin Vercel project.
--
--   psql "$ADMIN_DATABASE_URL_ADMIN" -f admin-role.sql
--
-- Why a dedicated role at all: apps/admin must read across every tenant, while
-- apps/dashboard must not. A dashboard credential is expected to be constrained
-- by tenant RLS and by application-level `organizationId` filters. If the admin
-- app simply reused it, every cross-tenant query would return zero rows and
-- staff would be unable to do their job; if the dashboard were ever handed this
-- role, tenant isolation would fail silently and catastrophically. Two roles
-- make both mistakes loud instead.
--
-- BEFORE RUNNING: replace the password below with a generated value and never
-- commit it.   CREATE ROLE ... PASSWORD '...' is inlined in server logs and in
-- the shell history, so prefer the psql \password prompt or pass it in via a
-- secret manager.
-- ═════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ─── Role ────────────────────────────────────────────────────────────────────
-- LOGIN because the app authenticates with a password.
-- NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOREPLICATION: the console needs to
--   read and lightly write rows, never to administer the instance.
-- BYPASSRLS is the entire point: tenant RLS is scoped to one organization, and
--   the console must see all of them. Note this also means a SQL injection in
--   apps/admin is not contained by RLS — treat admin query construction with the
--   same care as superuser code, and prefer Prisma's parameterised API.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rf_admin_app') THEN
    CREATE ROLE rf_admin_app
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      BYPASSRLS
      CONNECTION LIMIT 20;
    RAISE NOTICE 'created role rf_admin_app';
  ELSE
    RAISE NOTICE 'role rf_admin_app already exists — skipping CREATE ROLE';
  END IF;
END
$$;

-- Set/rotate the password separately so it never appears in this file:
--   psql "$DATABASE_URL" -c "ALTER ROLE rf_admin_app PASSWORD '...'"

-- ═════════════════════════════════════════════════════════════════════════════
-- GRANT MATRIX
-- ═════════════════════════════════════════════════════════════════════════════
-- Read (cross-tenant): organizations, users, customers, conversations, messages,
--                        projects, tasks, documents, insights, plans,
--                        subscriptions, organization_settings
-- Write:                rf_admin_users (own MFA/lockout/last-login columns only)
--                        organization_settings (per-org AI config)
--                        admin_audit_logs (append only)
-- No access:            invitations (holds live invite tokens), audit of the
--                        dashboard, and every other mutating path
--
-- Two tables need column-level grants rather than table-level ones:
-- `users` is redacted to a safe column list (it holds client password hashes),
-- and `organization_settings` is limited to editable columns so a row cannot be
-- re-pointed at another organization. `rf_admin_users` is the exception: the
-- console IS the credential store, so it needs its own secret columns — see the
-- note there for why that is deliberate. REVOKE first so this is idempotent.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── Default: nothing ─────────────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rf_admin_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM rf_admin_app;

-- Usage on the schema itself, so unqualified/SET search_path queries resolve.
GRANT USAGE ON SCHEMA public TO rf_admin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM rf_admin_app;

-- ─── Read: tenant and reference data ──────────────────────────────────────────
GRANT SELECT ON TABLE
  organizations,
  users,
  customers,
  customer_conversations,
  customer_messages,
  projects,
  tasks,
  documents,
  insights,
  plans,
  subscriptions
TO rf_admin_app;

-- `users` carries passwordHash: grant the safe columns explicitly instead.
-- Every column here is camelCase, so each must be double-quoted — unquoted
-- identifiers are folded to lower case and will not resolve.
REVOKE SELECT ON users FROM rf_admin_app;
GRANT SELECT (
  id, "organizationId", name, email, role, "isRFTeam", "createdAt", "updatedAt"
) ON users TO rf_admin_app;

-- ─── Read: per-organization AI settings ───────────────────────────────────────
GRANT SELECT ON organization_settings TO rf_admin_app;
-- The console edits per-org AI configuration, but must not be able to re-point a
-- row at a different organization (nor rewrite its identity/timestamps). A
-- table-level UPDATE would silently allow `SET "organizationId" = ...`, moving
-- another tenant's settings out from under them. Grant only the editable
-- columns; "updatedAt" is included because Prisma writes it on every update.
GRANT UPDATE (
  "aiProvider", "aiModel", "aiTemperature", "aiMaxTokens", "aiSystemPrompt",
  "aiContextWindow", "confidenceThreshold", "escalationThreshold",
  "autoReplyEnabled", "featureFlagsJson", "dataRetentionDays", "updatedAt"
) ON organization_settings TO rf_admin_app;
REVOKE INSERT, DELETE ON organization_settings FROM rf_admin_app;

-- ─── Write: RF admin accounts ────────────────────────────────────────────────
-- NOTE ON THE TWO SECRET COLUMNS. `passwordHash` and `mfaSecretCiphertext` are
-- granted to SELECT, and that is deliberate rather than an oversight:
--
--   • apps/admin IS the credential store's only legitimate consumer. It
--     verifies an admin's password on sign-in, and it decrypts the TOTP secret
--     to recompute the expected code. There is no way to authenticate an RF
--     admin without reading both, so redacting them from this role would simply
--     break the console.
--
-- The trust boundary is therefore the *credential*, not the grant: this role
-- exists in exactly one Vercel project, its password is never shared, and the
-- app must never return these fields in any response or log. If a future screen
-- ever needs to display admin rows, select the column list explicitly rather
-- than widening a table-level grant.
--
-- By contrast, `users.passwordHash` above IS redacted: the console never
-- authenticates a client user, so there is no reason for it to hold that value.
REVOKE ALL ON rf_admin_users FROM rf_admin_app;
GRANT SELECT ON rf_admin_users TO rf_admin_app;
-- Lockout counters, replay bookkeeping, last-login state, and the TOTP secret
-- itself: `admin:enrol-mfa` rotates mfaSecretCiphertext whenever an operator
-- enrols or re-enrols an authenticator, so that column must be writable here or
-- enrolment fails with a permission error.
--
-- "updatedAt" is required because Prisma writes it on every update regardless of
-- the fields in `data`. Omitting it makes *all* Prisma updates against this
-- table fail with "permission denied for table rf_admin_users", even when every
-- column named in the call is granted.
GRANT UPDATE (
  "lastLoginAt", "lastFailedLoginAt", "mfaEnabled", "mfaEnrolledAt",
  "mfaFailedAttempts", "mfaLockedUntil", "mfaLastUsedStep", "mfaSecretCiphertext",
  "updatedAt"
) ON rf_admin_users TO rf_admin_app;
-- Prisma sends schema-default scalars on create: it writes "mfaEnabled" and
-- "mfaFailedAttempts" (and "createdAt"/"updatedAt") even though the caller did
-- not supply them, so those columns must be INSERTable or every create fails.
GRANT INSERT (
  id, name, email, "passwordHash", "isActive",
  "mfaEnabled", "mfaFailedAttempts", "createdAt", "updatedAt"
) ON rf_admin_users TO rf_admin_app;

-- ─── Write: audit trail, append only ──────────────────────────────────────────
GRANT SELECT ON admin_audit_logs TO rf_admin_app;
GRANT INSERT ON admin_audit_logs TO rf_admin_app;
REVOKE UPDATE, DELETE ON admin_audit_logs FROM rf_admin_app;

-- ─── Sequences ───────────────────────────────────────────────────────────────
-- Only needed if a future table uses serial ids; harmless to grant on the
-- sequences backing the tables above.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rf_admin_app;

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═════════════════════════════════════════════════════════════════════════════
-- SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
--   FROM pg_roles WHERE rolname = 'rf_admin_app';
--   → rolsuper = f, rolbypassrls = t, rolcanlogin = t
--
-- Then confirm the redactions and the write limits actually hold:
--   SET ROLE rf_admin_app;
--   SELECT "passwordHash" FROM users LIMIT 1;
--     → ERROR: permission denied for table users
--   SELECT "token" FROM invitations LIMIT 1;
--     → ERROR: permission denied for table invitations
--   UPDATE admin_audit_logs SET "succeeded" = false;
--     → ERROR: permission denied for table admin_audit_logs   (append-only)
--   RESET ROLE;
-- ═════════════════════════════════════════════════════════════════════════════
