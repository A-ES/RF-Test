# Automated Database Backups & Restore Procedure

## 1. Overview

RF Intelligence database backups follow a dual-tier strategy to ensure data durability, zero data loss (RPO < 1 minute), and rapid recovery (RTO < 15 minutes).

| Strategy | Retention | Frequency | Purpose |
|---|---|---|---|
| **Point-in-Time Recovery (PITR)** | 7 to 30 days | Continuous WAL archiving | Disaster recovery & granular timestamp rollback |
| **Automated Daily Snapshots** | 30 days | Daily at 02:00 UTC | Offline / air-gapped backup & staging clones |

---

## 2. Backup Verification

Continuous backup validation runs automatically:
- **Daily WAL Archiving Status**: Monitored via cloud provider health check alerts.
- **Monthly Restore Testing**: Automated script restores the latest snapshot to an isolated staging database and runs integration integrity checks (`pnpm db:generate && pnpm test`).

---

## 3. Disaster Recovery / Restore Procedure

### Scenario A: Restore to a Specific Point in Time (PITR)

If data corruption or an erroneous script occurs at timestamp `T`:

1. **Stop active app instances**:
   Scale `apps/dashboard` and `apps/admin` deployments to 0 replicas to prevent concurrent database writes during recovery.

2. **Trigger PITR via Database Portal or CLI**:
   - Specify target timestamp `T - 1 minute` (e.g. `2026-09-28T12:00:00Z`).
   - Provision the restored database onto a clean target instance.

3. **Verify Restored Database**:
   ```bash
   # Connect to restored database
   psql "$RESTORED_DIRECT_URL" -c "SELECT count(*) FROM organizations;"
   psql "$RESTORED_DIRECT_URL" -c "SELECT count(*) FROM users;"
   ```

4. **Re-apply Database Roles & Security Matrix**:
   If restoring to a fresh PostgreSQL instance, re-run the role grant script:
   ```bash
   psql "$RESTORED_DIRECT_URL" -f packages/db/prisma/admin-role.sql
   psql "$RESTORED_DIRECT_URL" -c "ALTER ROLE rf_admin_app PASSWORD '<set_new_password>';"
   ```

5. **Update Connection Strings & Restart Apps**:
   Update `DATABASE_URL` / `DIRECT_URL` in Dashboard Vercel project, and `ADMIN_DATABASE_URL` in Admin Vercel project.

---

### Scenario B: Manual Restore from Local / S3 Dump (`pg_restore`)

To restore a `.dump` or `.sql` backup file into a target PostgreSQL database:

```bash
# 1. Drop existing public schema (CAUTION: erases target data)
psql "$DIRECT_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 2. Restore schema and data from dump
pg_restore --no-owner --no-privileges -d "$DIRECT_URL" ./backups/latest-rf-intelligence.dump

# 3. Apply Prisma migrations & role permissions
pnpm --filter @rf-intelligence/db db:generate
psql "$DIRECT_URL" -f packages/db/prisma/admin-role.sql
```

---

## 4. Emergency Contacts & Escalation

- **Database Admin / Ops**: `ops@rf-intelligence.com`
- **Security Lead**: `security@rf-intelligence.com`
