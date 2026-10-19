# WhatsApp Meta-Approved Templates Documentation

This document records the exact Meta-approved templates used by RF Intelligence for outbound customer communications when the 24-hour customer care messaging window has lapsed.

## Overview & Policy Compliance
Under Meta WhatsApp Business API rules:
- **Free-Form Messages**: Permitted only when the customer's last inbound message is under 24 hours old (`Date.now() - lastInbound.getTime() < 24h`).
- **Template Messages**: Required whenever the 24-hour window is closed. Only pre-approved templates with category `UTILITY` or `MARKETING` can be transmitted.
- **Email Fallback**: If a WhatsApp template is unavailable or rejected, the system automatically falls back to customer email and logs `TEMPLATE_UNAVAILABLE` on `NotificationLog`.

---

## Registered Meta Templates

### 1. `order_confirmed`
- **Category**: `UTILITY`
- **Language**: `en`
- **Trigger**: Order approved by administrator (`ORDER_CONFIRMED`).
- **Header**: Text: `Order Confirmed: {{1}}`
- **Body Text**:
  ```
  Hello {{1}}, your order {{2}} has been confirmed and is being processed. Total amount: {{3}}. View details or track your order in your customer portal. Thank you for your business!
  ```
- **Parameters**:
  1. `customerName` (e.g. `Acme Industrial`)
  2. `orderNumber` (e.g. `ORD-2026-0001`)
  3. `formattedTotal` (e.g. `₹25,000.00`)

### 2. `invoice_sent`
- **Category**: `UTILITY`
- **Language**: `en`
- **Trigger**: Official invoice generated and issued (`INVOICE_SENT`).
- **Header**: Document: Invoice PDF attachment
- **Body Text**:
  ```
  Hello {{1}}, invoice {{2}} for order {{3}} has been generated for {{4}}, due on {{5}}. You can view your invoice PDF or make a secure payment here: {{6}}.
  ```
- **Parameters**:
  1. `customerName` (e.g. `Acme Industrial`)
  2. `invoiceNumber` (e.g. `INV-2026-0001`)
  3. `orderNumber` (e.g. `ORD-2026-0001`)
  4. `formattedTotal` (e.g. `₹25,000.00`)
  5. `dueDate` (e.g. `12 Nov 2026`)
  6. `paymentLink` (e.g. `https://rzp.io/i/abc123` or terms message)

### 3. `payment_received`
- **Category**: `UTILITY`
- **Language**: `en`
- **Trigger**: Payment captured via Razorpay or entered manually (`PAYMENT_RECEIVED`).
- **Body Text**:
  ```
  Hello {{1}}, we have received your payment of {{2}} for order {{3}} (Invoice {{4}}). Remaining balance: {{5}}. Thank you!
  ```
- **Parameters**:
  1. `customerName` (e.g. `Acme Industrial`)
  2. `paidAmount` (e.g. `₹25,000.00`)
  3. `orderNumber` (e.g. `ORD-2026-0001`)
  4. `invoiceNumber` (e.g. `INV-2026-0001`)
  5. `outstandingBalance` (e.g. `₹0.00`)

### 4. `order_dispatched`
- **Category**: `UTILITY`
- **Language**: `en`
- **Trigger**: Order dispatched from warehouse (`ORDER_DISPATCHED`).
- **Body Text**:
  ```
  Hello {{1}}, your order {{2}} has been dispatched via {{3}}. Tracking reference: {{4}}. We will notify you once delivered.
  ```
- **Parameters**:
  1. `customerName` (e.g. `Acme Industrial`)
  2. `orderNumber` (e.g. `ORD-2026-0001`)
  3. `carrier` (e.g. `BlueDart Logistics`)
  4. `trackingRef` (e.g. `TRK987654321`)

### 5. `order_delivered`
- **Category**: `UTILITY`
- **Language**: `en`
- **Trigger**: Order delivered to customer delivery address (`ORDER_DELIVERED`).
- **Body Text**:
  ```
  Hello {{1}}, order {{2}} has been successfully delivered. Please inspect the shipment and let us know if you need any assistance.
  ```
- **Parameters**:
  1. `customerName` (e.g. `Acme Industrial`)
  2. `orderNumber` (e.g. `ORD-2026-0001`)

### 6. `order_rejected`
- **Category**: `UTILITY`
- **Language**: `en`
- **Trigger**: Admin rejects order draft with confirmed rejection message (`ORDER_REJECTED`).
- **Body Text**:
  ```
  Hello {{1}}, regarding your order inquiry {{2}}: {{3}}. Please contact our team for assistance.
  ```
- **Parameters**:
  1. `customerName` (e.g. `Acme Industrial`)
  2. `orderNumber` or `draftNumber` (e.g. `DFT-0001`)
  3. `rejectionReason` (e.g. `Item out of production`)

---

## Free-Form Messaging Templates (Within 24-Hour Window)
When the customer has messaged the business in the last 24 hours, the system renders human-friendly text with conversational tone into WhatsApp `text.body`:

1. **ORDER_CONFIRMED**:
   `Your order {{orderNumber}} has been confirmed! Total: {{formattedTotal}}. We are currently packing your items.`
2. **INVOICE_SENT**:
   `Invoice {{invoiceNumber}} for order {{orderNumber}} ({{formattedTotal}}) has been issued. Due date: {{dueDate}}. Pay online: {{paymentLink}}`
3. **PAYMENT_RECEIVED**:
   `Thank you! Payment of {{paidAmount}} received for {{orderNumber}}. Outstanding balance: {{outstandingBalance}}.`
4. **ORDER_DISPATCHED**:
   `Good news! Your order {{orderNumber}} is on its way via {{carrier}} (Tracking: {{trackingRef}}).`
5. **ORDER_DELIVERED**:
   `Your order {{orderNumber}} has been delivered. Thank you for choosing RF Intelligence!`
6. **ORDER_REJECTED**:
   `Notice regarding order {{orderNumber}}: {{rejectionReason}}`

---

## Idempotency and Delivery Auditing
- **Dedupe Key**: Every outbound customer message is logged in `NotificationLog` with unique key:
  `${orderId}:${event}:${version}`
- **Thread Insertion**: Each sent update is inserted into the customer conversation thread (`CustomerMessage`) with:
  `sender: "AI"` and content tagged `[automated update]`.
- **Status Updates**: Webhook status pings (`sent`, `delivered`, `read`, `failed`) update the corresponding `NotificationLog.status`.
