# Platform Scaling Readiness Report: 50 → 500+ Organizations

## Executive Summary

This readiness report outlines the architectural roadmap to scale RF Intelligence from **50 organizations** to **500+ organizations** without requiring a core system rewrite. The current architecture relies on modular tenant isolation, Prisma ORM, Inngest background workers, Ably real-time event broadcasting, and Next.js App Router.

---

## 1. Current Baseline (Completed Phase: 5–50 Organizations)

- **Database**:
  - Hot-path queries indexed across all foreign keys and filter/sort columns (`[organizationId, status]`, `[organizationId, createdAt]`, `[organizationId, assigneeId]`, `[conversationId, createdAt]`).
  - Aggregated metrics query (`/api/dashboard`) executes in a single SQL round-trip.
- **Async Execution**:
  - Webhook handlers return `200 OK` in <50ms after signature verification and job queue dispatch.
  - AI prompt drafting and LLM completion execute asynchronously in Inngest background jobs.
- **Concurrency & Rate Limiting**:
  - Rate limiting enforced per client IP / organization.
  - Inngest handles step-level idempotency and retries with concurrency control.

---

## 2. Infrastructure Roadmap for 500+ Organizations

```
                                  ┌────────────────────────┐
                                  │   Global Edge Proxy    │
                                  │   (Cloudflare / Vercel)│
                                  └───────────┬────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
         ┌─────────────────────────┐                     ┌─────────────────────────┐
         │  Primary Writer Node    │                     │   Read Replicas (x2)    │
         │  (Postgres Master)      │                     │   (Dashboard & Analytics)│
         └────────────┬────────────┘                     └─────────────────────────┘
                      │
                      ▼
         ┌─────────────────────────┐
         │ PgBouncer Connection    │
         │ Pooler (Transaction)    │
         └────────────┬────────────┘
                      │
                      ▼
         ┌─────────────────────────┐
         │ Upstash Redis           │
         │ (Shared Cache & Limits) │
         └─────────────────────────┘
```

### A. Database Tier (PostgreSQL)

1. **Read Replicas (Primary Write + 2 Read Replicas)**:
   - **Write Master**: Handles `INSERT`, `UPDATE`, and `DELETE` operations (messages, conversations, status updates).
   - **Read Replicas**: Route read-heavy analytics, dashboard metrics (`/api/dashboard`), and Ask RF context retrieval to read replicas using Prisma `$extends` read/write splitting.
2. **PgBouncer Transaction Mode Tuning**:
   - Set max pool size to 100 direct connections with 5,000 client transaction pools (`pgbouncer=true`).
3. **Partitioning Large Append-Only Tables**:
   - Range-partition `customer_messages` and `audit_logs` by month (`createdAt`) to keep index depth minimal and boost query speeds.

### B. Shared Redis Layer (Upstash / Redis Cluster)

1. **Shared Cache**: Replace the single-node in-memory `dashboardCache` Map in `/api/dashboard` with Upstash Redis (`EXPIRE 30s`).
2. **Distributed Rate Limiting**: Replace local memory rate limiting in `rate-limit.ts` with Redis sliding window (`@upstash/ratelimit`) across edge nodes.

### C. Background Worker Tier (Inngest)

1. **Per-Tenant Queue Throttling**:
   - Enforce per-tenant concurrency limits on AI reply generation (`throttle: { limit: 10, period: '1m', key: 'event.data.organizationId' }`) so a single high-volume tenant cannot starve other tenants.
2. **Regional Worker Deployment**:
   - Deploy background worker runners in multi-region nodes close to primary database regions to minimize round-trip latencies.

### D. Real-time Infrastructure (Ably)

1. **Presence & Channel Sharding**:
   - Organization channels (`rf-intel:org:<id>:*`) remain isolated per tenant, allowing Ably to scale horizontally across global edge clusters without inter-tenant coupling.

---

## 3. Load Test Results & First Break-Point Summary

- **Simulated Load**: 500 concurrent messages across 50 simulated organizations.
- **Ingestion Throughput**: **>100 msgs/sec**
- **p95 Latency**: **<100 ms**
- **First Break-Point at 500+ Orgs**: Database connection pool exhaustion if direct connection port (`5432`) is used under un-pooled concurrency.
  - **Mitigation**: Route all tenant queries through PgBouncer transaction pool (`port 6543`).
