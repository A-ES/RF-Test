# RF Admin console

Internal operations console for RF Intelligence staff. Separate Next.js app,
separate Vercel project, separate database credential, separate identity — it
shares only the Prisma schema with the client dashboard.

Scope of this document: deployment, credential separation, the database role,
and MFA operations. Feature screens are out of scope here.

---

## 1. Why a separate app

`apps/admin` reads across every tenant. `apps/dashboard` is tenant-scoped. If
they shared a database credential, one of two things would happen, both bad:

- The admin console inherits tenant RLS and every cross-tenant query silently
  returns zero rows.
- The dashboard inherits `BYPASSRLS` and tenant isolation fails silently.

Neither raises an error. So the separation is enforced in three places: separate
Vercel projects, separate connection strings, and a runtime assertion.

| | `apps/dashboard` | `apps/admin` |
|---|---|---|
| Env var | `DATABASE_URL` | `ADMIN_DATABASE_URL` |
| `RF_APP` | unset | `admin` |
| DB role | tenant role (no `BYPASSRLS`) | `rf_admin_app` (`BYPASSRLS`) |
| Session cookie | `rf_session` | `__Host-rf_admin_session` |
| Signing secret | `AUTH_SECRET` | `RF_ADMIN_SESSION_SECRET` |
| Identity table | `users` | `rf_admin_users` |
| TOTP secret encryption | n/a | `RF_ADMIN_MFA_ENCRYPTION_KEY` |

`packages/db` selects the connection string from `RF_APP`. If `RF_APP=admin` and
`ADMIN_DATABASE_URL` is missing, the client throws at startup rather than
falling back to `DATABASE_URL` — a silent fallback would hand the console the
tenant credential.

The session cookies are host-only (no `Domain` attribute), so the browser never
attaches one app's cookie to the other host. The signing keys must be different
values: shared keys would let a token minted in one app verify in the other.

---

## 2. Database role

Applied by `packages/db/prisma/admin-role.sql`, once per environment, as a role
with `CREATEROLE`:

```bash
psql "$ADMIN_DATABASE_URL_ADMIN" -f packages/db/prisma/admin-role.sql
psql "$ADMIN_DATABASE_URL_ADMIN" -c "ALTER ROLE rf_admin_app PASSWORD '<generated>'"
```

The script is idempotent and ends with the queries that verify it.

### Grant matrix

| Table | Access |
|---|---|
| `organizations`, `projects`, `tasks`, `documents`, `insights` | `SELECT` |
| `customers`, `customer_conversations`, `customer_messages` | `SELECT` (all tenants) |
| `users` | `SELECT` on 8 columns; **no** `passwordHash` |
| `plans`, `subscriptions` | `SELECT` |
| `organization_settings` | `SELECT`, `UPDATE` on AI-config columns only |
| `rf_admin_users` | `SELECT`, `UPDATE` on MFA/login columns, `INSERT` |
| `admin_audit_logs` | `SELECT`, `INSERT` only (append-only) |
| `invitations` | none — holds live invite tokens |
| everything else | none |

Two notes on the deliberate exceptions:

- **`rf_admin_users.passwordHash` and `mfaSecretCiphertext` are readable.** The
  console *is* the credential store's only legitimate consumer: it verifies an
  admin's password and decrypts the TOTP secret. Redacting them would break
  authentication. The trust boundary is the credential itself — it exists in one
  Vercel project and is never shared — not the grant. Never return these fields
  in a response or log line.
- **`users.passwordHash` is redacted.** The console never authenticates a client
  user, so there is no reason for it to hold that value.

`organization_settings` gets a **column-level** `UPDATE`, not a table-level one:
a table-level grant would let the console re-point another tenant's settings row
with `SET "organizationId" = ...`. Only the AI-config columns plus `"updatedAt"`
are writable; `"id"`, `"organizationId"` and `"createdAt"` are not.

`"updatedAt"` is in both `UPDATE` lists because Prisma writes it on every update
regardless of the `data` passed. Likewise the `rf_admin_users` `INSERT` list
includes `"mfaEnabled"`, `"mfaFailedAttempts"`, `"createdAt"` and `"updatedAt"`,
which Prisma sends on create even when the caller does not supply them; omitting
any of them makes `admin:create` fail with `permission denied`.

`admin_audit_logs."adminId"` is **nullable and has no foreign key**. A failed
login against an unknown email has no `RfAdminUser` row to reference, and an
audit trail must not be cascaded away when the staff account behind it is
deleted. The console credential can only `INSERT` here, so no referential
integrity is lost.

### Verify after applying

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
  FROM pg_roles WHERE rolname = 'rf_admin_app';
-- expect: rolsuper = f, rolbypassrls = t, rolcanlogin = t

SET ROLE rf_admin_app;
SELECT "passwordHash" FROM users LIMIT 1;         -- must ERROR
SELECT "token" FROM invitations LIMIT 1;           -- must ERROR
UPDATE admin_audit_logs SET "succeeded" = false;  -- must ERROR (append-only)
UPDATE organization_settings SET "organizationId" = 'x';  -- must ERROR (column-level)
UPDATE organization_settings SET "aiModel" = 'x' WHERE false;  -- must be permitted
INSERT INTO admin_audit_logs (id, action, "entityType", succeeded)
  VALUES (gen_random_uuid()::text, 'probe', 'probe', true);    -- must succeed (adminId null)
SELECT count(*) FROM customers;                   -- must return every tenant
RESET ROLE;
```

`BYPASSRLS` means a SQL injection in `apps/admin` is not contained by RLS. Use
Prisma's parameterised API; never interpolate user input into `$queryRawUnsafe`.

---

## 3. Environment variables

Set on the **admin** Vercel project only:

| Variable | Purpose |
|---|---|
| `RF_APP` | `admin` — selects `ADMIN_DATABASE_URL`. **Set automatically** by `next.config.ts`; do not override. |
| `ADMIN_DATABASE_URL` | `rf_admin_app` credential, **direct port 5432** |
| `RF_ADMIN_SESSION_SECRET` | Signs the session cookie. `openssl rand -base64 32` |
| `RF_ADMIN_MFA_ENCRYPTION_KEY` | AES-256 key, base64, exactly 32 bytes. `openssl rand -base64 32` |
| `ADMIN_IP_ALLOWLIST` | Comma-separated IPs/CIDRs. Unset in production = deny all |

`RF_APP` is hardcoded to `admin` in `next.config.ts` (and prefixed onto the two
`ts-node` scripts) rather than left to the environment. Without it,
`packages/db` resolves `DATABASE_URL` instead — so a misconfigured project, or
one whose env was copied from the dashboard, would connect the console with the
dashboard's credential. Hardcoding removes that class of mistake. Do **not** add
`DATABASE_URL` to the admin project.

`ADMIN_DATABASE_URL` must not use port 6543 or `pgbouncer=true`. The app throws
at startup if it does: a transaction-mode pooler cannot preserve the session GUCs
that tenant context relies on.

**Rotating `RF_ADMIN_MFA_ENCRYPTION_KEY` invalidates every enrolment.** There is
no recovery path — re-run `admin:enrol-mfa` for each admin afterwards.

---

## 4. Vercel setup

1. New project, root directory `apps/admin`, framework Next.js. Do **not** add
   `apps/dashboard` to the same project.
2. Attach the custom domain `admin.rfintelligence.<domain>`.
3. Set the environment variables from section 3.
4. **Enable Deployment Protection** (Settings → Deployment Protection →
   Vercel Authentication, and/or an IP allowlist). This is a separate layer from
   the app's own `ADMIN_IP_ALLOWLIST`; keep both.
5. Confirm the app is unreachable from outside: an unauthenticated request to
   `/` should redirect to `/login`, and a request from a non-allowlisted IP
   should return `403`.

The monorepo lives outside the Vercel project root, so `vercel.json` sets
`installCommand` and `buildCommand` to operate from the repo root. Confirm the
Vercel project's "Include source files outside of the Root Directory" setting
matches, or add `apps/dashboard`, `apps/website` and `packages/*` to the
project's ignored build step as needed.

### noindex

Three layers, because each covers a case the others miss:

- `X-Robots-Tag` header on every response (`next.config.ts` and `proxy.ts`),
  including errors and redirects that never render the layout.
- `metadata.robots` in the root layout.
- `app/robots.ts` disallowing `/`.

---

## 5. Access control layers

From outermost to innermost:

1. **Vercel Deployment Protection** — Vercel-level auth, not in the repo.
2. **`ADMIN_IP_ALLOWLIST`** — `proxy.ts`, before any route runs. Fails closed:
   unset in production denies every request. Trusts `x-vercel-forwarded-for`,
   which is only sound because Vercel overwrites it. If the app is ever exposed
   directly, move this to a proxy rule.
3. **Session cookie** — host-only, `httpOnly`, `sameSite=strict`,
   `__Host-` prefixed in production, 8h TTL.
4. **TOTP** — mandatory. `POST /api/auth/login` issues only a 5-minute MFA
   challenge, never a session. `POST /api/auth/login/mfa` is the only route that
   can mint a session.

### MFA properties

- 5 consecutive wrong codes locks the account for 15 minutes. The counter
  resets only on success, so attempts cannot be ground down.
- A TOTP code is valid for one time step. `mfaLastUsedStep` records the last
  spent step, so replaying the same six digits inside the same 30-second window
  is refused. A replayed or locked-out attempt burns the challenge, forcing a
  fresh password entry.
- An admin with `mfaEnabled = false` cannot obtain a session at any point, and
  an existing session stops resolving if MFA is later disabled.
- An admin deactivated mid-session is signed out on the next request.

---

## 6. Operations

```bash
# Create an operator (no signup path exists by design)
pnpm --filter @rf-intelligence/admin admin:create --email someone@rf-intelligence.com --name "Someone"

# Enrol / re-enrol an authenticator
pnpm --filter @rf-intelligence/admin admin:enrol-mfa --email someone@rf-intelligence.com
```

Both need the admin app's environment (`ADMIN_DATABASE_URL`,
`RF_ADMIN_MFA_ENCRYPTION_KEY`). `admin:create` refuses passwords under 12
characters and reads them without echo.

The seed creates exactly one admin (`admin@rf-intelligence.com`) with MFA
**disabled** — enrolment needs the encryption key, which a shared seed does not
have. An admin with no MFA cannot sign in, so enrolment is a required step after
seeding, not an optional hardening one.

Check the console's credential with `GET /api/health`, which reports the current
role and whether it bypasses RLS.

### Audit trail

`admin_audit_logs` records `admin.login.*` events including failures. It is
append-only from the app's perspective. `organizationId`, `targetEmail` and
`adminId` are all denormalized (no foreign keys) so a trail survives deletion of
the organization, user or staff account it refers to; a failed login against an
unknown email is stored with a null `adminId` rather than being dropped.

---

## 7. Known limitations

- `20260911_enable_rls` references `organization_id`, but the real columns are
  camelCase (`"organizationId"`), so those policies do not apply. There is no
  `_prisma_migrations` table in production — the database is `db push`-managed.
  **Do not run `prisma migrate deploy`** until the migration history is
  reconciled; it will fail.
- Tenant RLS is currently unenforced in practice. The dashboard connects as
  Supabase's `postgres` role, which **also** has `rolbypassrls = t`, so it is not
  constrained by RLS either; tenant isolation rests on application-level
  `organizationId` filters. The `organization_settings` policy and the new
  customer/conversation policies are written and correct, but they are
  defence-in-depth against a leaked *third* credential, not enforcement today.
  Because the dashboard's legitimate role already bypasses RLS, a runtime
  "dashboard must not bypass RLS" assertion is **not** viable until the dashboard
  is given its own non-bypass role — that is the real prerequisite, not a guard.
- The dashboard's own client-user passwords are still bare SHA-256. The admin
  path uses scrypt; migrating `User` is out of scope here.
- No feature screens. The placeholder at `/` exists to establish the
  authenticated shell.
