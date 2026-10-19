# RF Intelligence — Production Operations Runbook

This runbook outlines operational procedures, architecture specifications, failure recovery workflows, and emergency triage for the RF Intelligence platform.

---

## 1. System Architecture & Lifecycle

```
[Customer WhatsApp / Email]
           │
           ▼
[POST /api/webhooks/whatsapp]
           │ (HMAC Verified)
           ▼
[Inbound Ingest & Intent Router] ────► [createDraftOrder Inngest Job]
                                                 │
                                                 ▼
                                     [Draft Order Created]
                                                 │
                                                 ▼
                                     [Admin Review & Approval]
                                                 │ (Atomic DB Tx)
                                                 ▼
                                     [Inngest: order.approved]
                                                 │
                  ┌──────────────────────────────┴──────────────────────────────┐
                  ▼                                                             ▼
     [Gapless Invoice Number & PDF]                              [Payment Link Generated]
                  │                                                             │
                  └──────────────────────────────┬──────────────────────────────┘
                                                 ▼
                                  [Customer Notification Sent]
                                                 │
                                                 ▼
                                  [Payment Webhook Captured]
                                                 │ (HMAC & Replay Safe)
                                                 ▼
                                    [Fulfillment Board Transition]
                                     Pending ➔ Packing ➔ Dispatched
                                                 │
                                                 ▼
                                    [Atomic Stock Commit]
                              (Reserved ➔ On-Hand Decrement)
                                                 │
                                                 ▼
                                   [Delivered & Customer Update]
```

---

## 2. Invoicing Subsystem
- **Sequential Gapless Numbers**: Allocated via atomic `OrgCounter` upsert in PostgreSQL (`INV-YYYY-XXXX`). Guarantees no duplicates and no gaps under high concurrency.
- **Server-Side PDF Binary**: Generated in [apps/dashboard/app/lib/invoices/pdf.ts](file:///Users/user/Documents/RF_INTELLIGENCE/apps/dashboard/app/lib/invoices/pdf.ts) with org metadata, tax ID, line-item table, tax rate breakdown, and payment link/QR.
- **Void & Reissue**: Executed via `POST /api/orders/:id/invoices/void-reissue`. The sequential `invoiceNumber` is preserved, the previous invoice is marked `VOID`, and the logged reason is captured in the audit log.

---

## 3. Payments & Webhook Reconciliation
- **HMAC Verification**: Razorpay webhooks require `x-razorpay-signature` validated with `RAZORPAY_WEBHOOK_SECRET`.
- **Idempotency & Replay Protection**: Webhook deliveries deduplicate on `providerPaymentId`. Replayed deliveries return HTTP 200 with `isReplay: true` and execute zero database writes.
- **Partial, Over, and Out-of-Order Handling**: Order `paymentStatus` is recalculated dynamically from net successful payments:
  - `netPaid == 0`: `UNPAID` (or `REFUNDED` if prior refunds exist)
  - `netPaid < order.totalMinor`: `PARTIAL`
  - `netPaid >= order.totalMinor`: `PAID`
- **Manual Payment Entry**: Administrators record manual bank transfers via `POST /api/orders/:id/payments/manual`, creating an audit log and notifying team members.

---

## 4. Fulfillment & Inventory Commit Math
- **Forward Transitions**: Statuses move `PENDING` &rarr; `PACKING` &rarr; `DISPATCHED` &rarr; `DELIVERED`.
- **Payment Rule Gate**: `PACKING` is blocked unless `fulfillmentRequires` rule (e.g., `PAYMENT_PAID`) is satisfied, or bypassed by an administrator with a logged `overrideReason`.
- **Commit Math on Dispatched**:
  - `onHand` decreases by fulfilled quantity.
  - `reserved` decreases by fulfilled quantity.
  - `available` (`onHand - reserved`) remains mathematically unchanged.
  - Under no circumstances can on-hand fall below zero unless backorders are enabled for the tenant.
- **Pre-Dispatch Cancellation**: `cancelOrderBeforeDispatch` releases reserved stock atomically and sets status `CANCELLED`.
- **ERP Failure Seam**: If an external ERP provider fails, the local stock movement is preserved, the order event records `SYNC_FAILED`, and operators can click **Retry ERP Sync** on the fulfillment drawer or invoke `POST /api/orders/:id/fulfillment/retry-erp`.

---

## 5. Customer Notifications & Care Window
- **Customer Lifecycle Events**:
  - `ORDER_CONFIRMED`
  - `INVOICE_SENT`
  - `PAYMENT_RECEIVED`
  - `ORDER_DISPATCHED`
  - `ORDER_DELIVERED`
  - `ORDER_REJECTED`
- **24-Hour WhatsApp Service Window**:
  - Last inbound < 24 hours: Free-form message with rich order details.
  - Last inbound &ge; 24 hours: Meta-approved templates (documented in [docs/whatsapp-templates.md](file:///Users/user/Documents/RF_INTELLIGENCE/docs/whatsapp-templates.md)).
  - If template unavailable or fails: Falls back to email and logs `TEMPLATE_UNAVAILABLE`.
- **Deduplication**: Key `${orderId}:${event}:${version}` prevents duplicate customer updates.

---

## 6. Health & Diagnostics (/admin/health)
Access the health console at `/admin/health` or `GET /api/admin/health`:
- **Database Latency**: Probes round-trip database query latency (healthy < 50ms).
- **Queue Lag**: Tracks count of in-flight orders awaiting review (`NEEDS_REVIEW`).
- **Last Inbound Webhook**: Reports timestamp of the most recent webhook event.
- **Failed Notifications**: Counts delivery drops in `NotificationLog`.
- **ERP Failures**: Counts `SYNC_FAILED` movements needing operator manual retry.

### Triage Checklist for Degraded State
1. **ERP Failures > 0**:
   - Open `/orders/fulfillment`.
   - Open the drawer for the affected order.
   - Click **Retry ERP Sync** once ERP network connectivity is restored.
2. **Failed Notifications > 0**:
   - Inspect `NotificationLog` table for error strings.
   - Verify `WHATSAPP_ACCESS_TOKEN` has not expired.
   - Ensure customer contact number is in valid E.164 format.
3. **Queue Lag Spike**:
   - Review `/orders` with filter `Awaiting Approval`.
   - Ensure warehouse or lead administrator reviews drafts with flags.
