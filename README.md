# RF Intelligence

> An intelligence layer for business operations — not another dashboard.

RF Intelligence is the marketing and lead-generation site for an early-stage automation company. It presents what the company does, how its Understand → Decide → Execute approach works, and drives qualified visitors to **Book a Demo**.

The site is built to communicate one thing within seconds of landing: this is enterprise-grade automation, not a generic startup landing page.

---

## ✨ Highlights

- **Interactive 3D hero** — real-time WebGL scenes (custom GLSL terrain, glass shard effects) rendered with Three.js
- **Cinematic motion design** — physics-based transitions and scroll-driven animations via Framer Motion
- **Full marketing site** — About, Services, Industries, Benefits, How It Works, Why RF, Contact, and Book-a-Demo pages
- **Legal & trust pages** — Privacy Policy, Terms of Service, Cookie Policy, Security, Data Processing
- **Design system** — reusable bento cards, animated slideshows, resizable navbar, themed buttons; tokens centralized in `lib/tokens.ts`
- **Production-ready stack** — Next.js App Router, TypeScript strict mode, Tailwind CSS v4, ESLint + Prettier

## 🧱 Tech Stack

| Layer      | Technology                                        |
| ---------- | ------------------------------------------------- |
| Framework  | [Next.js](https://nextjs.org) 16 (App Router)     |
| Language   | TypeScript                                        |
| UI         | React 19, Tailwind CSS 4, shadcn/ui               |
| 3D / WebGL | Three.js with custom GLSL shaders                 |
| Motion     | Framer Motion                                     |
| Icons      | Hugeicons, Tabler, Lucide                         |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
cd rf-intelligence
npm install
```

### Run in development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build for production

```bash
npm run build
npm start
```

### Lint

```bash
npm run lint
```

## 📁 Project Structure

```
rf-intelligence/
├── app/                  # Routes (App Router)
│   ├── page.tsx          # Landing page
│   ├── about/            # Company overview
│   ├── services/         # Service offerings
│   ├── industries/       # Industry use cases
│   ├── benefits/         # Before/after value
│   ├── how-it-works/     # Process explainer
│   ├── why-rf/           # Differentiation
│   ├── book-a-demo/      # Primary conversion path
│   ├── contact/
│   └── legal/            # Policy pages
├── components/
│   ├── canvas/           # WebGL scenes (GLSL hills, glass shards)
│   ├── sections/         # Page-level sections (Hero, Navbar, etc.)
│   └── ui/               # Reusable UI primitives
└── lib/                  # Theme context, design tokens, utilities
```

## 🎯 Design Principles

1. **Clarity under decoration** — every animation serves the story, not the other way around.
2. **B2B first** — the visitor journey is optimized for operations decision-makers evaluating automation.
3. **One conversion goal** — all CTAs consistently lead to *Book a Demo*.
4. **Trust by default** — security, privacy, and data-handling pages are first-class citizens.

## 🤝 Contributing

Branches are feature-scoped and merged into `main` via pull requests. Run `npm run lint` before opening a PR. Prettier config lives in `.prettierrc`.

## ⏱️ 10-Minute Evaluator Demo Script

Follow this step-by-step 10-minute walkthrough to verify the complete operational flow, confirmation gates, realtime feeds, and audit trail:

### Minute 0:00 – 2:00: Omnichannel Messaging & Realtime Ingestion (`/conversations`)
1. **Navigate to Conversations**: Open [http://localhost:3000/conversations](http://localhost:3000/conversations).
2. **Observe Realtime Badge & Feed**: Notice the live realtime status pill in the header dynamically reflecting WebSocket connection health (`Live Connected` / `Polling Fallback`).
3. **Omnichannel Filters & Quick Search**:
   - Press <kbd>Cmd</kbd> + <kbd>K</kbd> (or <kbd>Ctrl</kbd> + <kbd>K</kbd>) to instantly focus the debounced search bar (300ms debounce with `AbortController`).
   - Switch between channel pills: **All Channels**, **WhatsApp**, **SMS**, **Email**, **Web Chat**.
   - Note the channel-specific status badges (**Open**, **Waiting Client**, **Closed**) and dynamic user presence indicator (online <15m, dnd <24h, offline).
4. **Thread Inspection & Audio Voice Notes**:
   - Select a conversation. Notice date separators ("Today", "Yesterday") and correct "WhatsApp" casing.
   - Inspect voice note audio messages transcribed through the `Transcriber` interface and stored in the private media bucket.
   - If confidence falls below threshold (0.85), observe the proactive Escalation Banner displaying exact `confidenceScore` and threshold.
5. **Team Collaboration & Attachments**:
   - Click the assignee dropdown to assign/reassign eligible teammates (`CLIENT_ADMIN`, `CLIENT_EMPLOYEE`, `ADMIN`) with audit trail logging.
   - Click the paperclip icon to upload documents/images (enforcing 10MB limits) with thumbnail chip previews.
   - Select "Reply Quote" on any customer bubble to automatically quote their message into the composer.

---

### Minute 2:00 – 4:00: Inbound WhatsApp Order Ingestion & Safety Gates (`/orders`)
1. **Customer Inbound Order**: A customer messages `"Hi, I need 20 cases of Product A and 10 units of Product B delivered tomorrow"` (also supports voice notes and misspelt variants e.g. `"Poduct A"`).
2. **Deterministic Extraction & Zero-Stock Safety**:
   - The system ingests the message, normalizes phone numbers to E.164, and identifies the customer profile.
   - DeepSeek/Deterministic extraction maps items to catalog SKUs (`PROD-A`, `PROD-B`) and parses delivery dates against the organization's timezone.
   - Exactly **one** Draft order is created (`DFT-0001`).
   - **Crucial Confirmation Gate**: On-hand stock is **completely untouched** (`StockMovement` count is 0, reserved stock is 0), and **no confirmation or invoice message is sent** to the customer before administrative approval.
3. **Stock Shortage Handling**: If a customer requests quantities exceeding available stock, the order is automatically flagged `INSUFFICIENT_STOCK` and status set to `NEEDS_REVIEW`.

---

### Minute 4:00 – 6:00: Admin Review, Re-Pricing & Atomic Approval (`/orders/[id]`)
1. **Open Order Detail**: Open the draft order at `/orders/[id]`.
2. **Line Item Editing & Pure Pricing Engine**:
   - Adjust Product A quantity from 20 to 15 cases.
   - The server strictly ignores client-supplied totals and re-prices through `priceOrder` (pure function applying customer-specific prices, priority-stacked discount rules, and half-up tax rounding).
   - Optimistic concurrency enforces version matching (`version: 1` &rarr; `version: 2`), rejecting stale submissions with `409 Conflict`.
3. **Approve Order**:
   - Click **Approve Order**. The approval executes inside a single ACID database transaction:
     - Enforces administrator role (`CLIENT_ADMIN` or `ADMIN` only; non-admin or AI actors are rejected with `403 Forbidden`).
     - Allocates a sequential gapless order number from `OrgCounter` (`ORD-YYYY-XXXX`).
     - Atomically reserves inventory via `InventoryProvider` (Product A reserved: 15, Product B reserved: 10; available stock drops accordingly).
     - Initializes the fulfillment record and records `OrderEvent(APPROVED)`.

---

### Minute 6:00 – 8:00: Sequential Invoicing, PDF Generation & Payment Webhooks
1. **Automatic Gapless Invoicing**:
   - Post-approval workflow assigns gapless sequence invoice number (`INV-YYYY-XXXX`).
   - Generates server-side PDF invoice with organization logo, tax ID, line-item tax breakdown, and signed private-bucket URL.
2. **Razorpay Payment Link & Customer WhatsApp Update**:
   - Generates Razorpay payment link.
   - Dispatches official WhatsApp invoice update to the customer with payment link.
3. **Simulated Payment Webhook**:
   - Simulated signed webhook (`payment_link.paid`) arrives at `/api/webhooks/payments/razorpay` with valid HMAC-SHA256 signature.
   - Deduplicates on `providerPaymentId`.
   - Transitions Order and Invoice `paymentStatus` to `PAID`.
   - Writes `Payment` row and customer payment confirmation log.

---

### Minute 8:00 – 9:00: Multi-Stage Fulfillment Drawer (`/orders/fulfillment`)
1. **Open Fulfillment Drawer**: Navigate to `/orders/fulfillment` or click **Manage Fulfillment** on the order page.
2. **Progress Stages**:
   - **Packing**: Sets status to `FULFILLING`. Validates prerequisites (`fulfillmentRequires: PAYMENT_PAID`).
   - **Dispatched**: Enter carrier (`BlueDart Express`) and tracking number (`BD-123456789`).
     - **Atomic Stock Commit**: On-hand stock is decremented **exactly once** (Product A: 100 &rarr; 85; Product B: 50 &rarr; 40).
     - Releases reservation and records `StockMovement(FULFILLMENT)`.
     - Sends customer WhatsApp dispatch notice.
   - **Delivered**: Marks order `DELIVERED` and sends final completion update.

---

### Minute 9:00 – 10:00: Unified Order Timeline, Analytics Dashboard & System Health
1. **Inspect Unified `<OrderTimeline>`**:
   - View the unified timeline merging `OrderEvent`, `NotificationLog`, and `Payment` records in chronological order with actor badges, before/after states, and formatted timestamps.
2. **Executive Overview Dashboard (`/orders/overview`)**:
   - Open `/orders/overview`.
   - Filter by date range (default 30 days).
   - Review metric cards: New Orders, Awaiting Approval (oldest age), Approved, Rejected, Fulfillment counts (Pending, Packing, Dispatched, Delivered), Payment breakdowns, Revenue, AOV, and Low Stock count.
   - Review interactive charts: Daily revenue/order volume, conversion/fulfillment funnel, top products, top customers, inventory health, and overdue invoices.
   - Click **Export Orders CSV** (`/api/orders/export`) and **Export Payments CSV** (`/api/payments/export`).
3. **Customer History Side Panel (`/customers/[id]`)**:
   - View Customer Profile with lifetime spend, orders count, and dedicated **Orders Tab**.
4. **Operations Health Monitor (`/admin/health`)**:
   - Open `/admin/health` to view live database latency, background queue lag, webhook throughput, failed notification rate, and ERP inventory status.

---

## 🧪 Verification & Test Suites

Run the automated test suites to verify all 9 specification sections and CI guardrails:

```bash
# Run CI Operational Guardrail tests (17 table-driven tests)
npx vitest run app/lib/orders/guardrails.test.ts

# Run Full End-to-End lifecycle test suite
npx vitest run app/lib/orders/full-e2e.test.ts

# Run the complete test suite (53 test files, 401+ tests)
pnpm --filter @rf-intelligence/dashboard test -- --run
```

## 📄 License

Private and proprietary — © RF Intelligence. All rights reserved.
