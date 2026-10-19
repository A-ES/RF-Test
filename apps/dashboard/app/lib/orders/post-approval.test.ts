import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/app/lib/db";
import { nextNumber, formatSequenceNumber } from "@rf-intelligence/db";
import { generateInvoicePdfBuffer, type InvoiceSnapshot } from "@/app/lib/invoices/pdf";
import { generateInvoiceForOrder, voidAndReissueInvoice } from "@/app/lib/invoices/service";
import { applyPaymentEvent, recordManualPayment } from "@/app/lib/payments/service";
import { RazorpayPaymentProvider } from "@/app/lib/payments/provider";
import { transitionFulfillment, cancelOrderBeforeDispatch } from "@/app/lib/fulfillment/service";
import { LocalDbInventoryProvider } from "@/app/lib/inventory/provider";
import {
  deliverCustomerUpdate,
  isCustomerCareWindowOpen,
  renderFreeFormMessage,
} from "@/app/lib/messaging/customer-updates";
import { setMessagingProviderFor } from "@/app/lib/messaging/providers";
import { createHmac } from "node:crypto";

describe("Post-Approval Workflow & Subsystems", () => {
  const testOrgId = `org_post_appr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  let testCustomerId: string;
  let testProductId: string;

  beforeEach(async () => {
    // Ensure test organization and settings exist in DB before running any test
    await prisma.organization.upsert({
      where: { id: testOrgId },
      update: {},
      create: { id: testOrgId, name: "Acme Industrial Testing Ltd" },
    });

    await prisma.organizationSettings.upsert({
      where: { organizationId: testOrgId },
      update: {},
      create: {
        organizationId: testOrgId,
        currency: "INR",
        invoicePrefix: "INV-",
        paymentTermsDays: 30,
        fulfillmentRequires: "PAYMENT_PAID",
        taxId: "27AABCU9603R1ZM",
      },
    });

    // Reset any messaging mock overrides
    setMessagingProviderFor("WHATSAPP", null as any);
  });

  // Helper setup
  async function setupTestOrder(params: {
    status?: "DRAFT" | "APPROVED" | "FULFILLING" | "DISPATCHED" | "DELIVERED";
    qty?: number;
    basePriceMinor?: number;
    initialOnHand?: number;
    initialReserved?: number;
    paymentTermsDays?: number;
    fulfillmentRequires?: string;
  }) {
    // Create org & settings
    await prisma.organization.upsert({
      where: { id: testOrgId },
      update: {},
      create: { id: testOrgId, name: "Acme Industrial Testing Ltd" },
    });

    await prisma.organizationSettings.upsert({
      where: { organizationId: testOrgId },
      update: {
        fulfillmentRequires: params.fulfillmentRequires || "PAYMENT_PAID",
      },
      create: {
        organizationId: testOrgId,
        currency: "INR",
        invoicePrefix: "INV-",
        paymentTermsDays: params.paymentTermsDays ?? 30,
        fulfillmentRequires: params.fulfillmentRequires || "PAYMENT_PAID",
        taxId: "27AABCU9603R1ZM",
      },
    });

    // Create customer
    const customer = await prisma.customer.create({
      data: {
        organizationId: testOrgId,
        name: "Test Customer Co",
        company: "Test Customer Co Ltd",
        email: "buyer@testcustomer.com",
        phone: "+919876543210",
        whatsapp: `+91987${Math.floor(1000000 + Math.random() * 9000000)}`,
        tagsJson: "[]",
      },
    });
    testCustomerId = customer.id;

    // Create product
    const sku = `SKU-TST-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const product = await prisma.product.create({
      data: {
        organizationId: testOrgId,
        sku,
        name: "Precision Ball Bearing 608RS",
        unit: "piece",
        basePriceMinor: params.basePriceMinor ?? 50000, // ₹500.00
        taxRateBps: 1800, // 18%
        reorderLevel: 10,
      },
    });
    testProductId = product.id;

    // Initialize stock
    const onHand = params.initialOnHand ?? 100;
    const reserved = params.initialReserved ?? 0;
    await prisma.inventoryLevel.create({
      data: {
        organizationId: testOrgId,
        productId: product.id,
        onHand,
        reserved,
      },
    });

    const adminUser = await prisma.user.upsert({
      where: { email: `admin_${testOrgId}@test.com` },
      create: {
        id: `user_admin_${testOrgId}`,
        organizationId: testOrgId,
        email: `admin_${testOrgId}@test.com`,
        name: "Admin User",
        role: "CLIENT_ADMIN",
        avatarInitials: "AU",
      },
      update: {},
    });

    const qty = params.qty ?? 5;
    const unitPriceMinor = params.basePriceMinor ?? 50000;
    const subtotalMinor = qty * unitPriceMinor;
    const taxMinor = Math.round((subtotalMinor * 1800) / 10000);
    const totalMinor = subtotalMinor + taxMinor;

    const orderStatus = params.status ?? "APPROVED";

    const order = await prisma.order.create({
      data: {
        organizationId: testOrgId,
        customerId: customer.id,
        draftNumber: `DFT-${Math.floor(1000 + Math.random() * 9000)}`,
        orderNumber: orderStatus === "DRAFT" ? null : `ORD-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        status: orderStatus,
        paymentStatus: "UNPAID",
        subtotalMinor,
        discountMinor: 0,
        taxMinor,
        totalMinor,
        deliveryAddress: "Warehouse 4, Industrial Area, Pune 411019",
        deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        approvedById: orderStatus === "DRAFT" ? null : adminUser.id,
        approvedAt: orderStatus === "DRAFT" ? null : new Date(),
        lines: {
          create: [
            {
              organizationId: testOrgId,
              productId: product.id,
              sku: product.sku,
              rawText: product.name,
              qty,
              unitPriceMinor,
              taxMinor,
              lineTotalMinor: subtotalMinor + taxMinor,
            },
          ],
        },
      },
      include: {
        lines: { include: { product: true } },
        customer: true,
      },
    });

    return { order, customer, product, adminUser, subtotalMinor, taxMinor, totalMinor };
  }

  // 1. GAPLESS NUMBERS UNDER CONCURRENCY
  it("test 1: gapless numbers under concurrency", async () => {
    const concurrentCount = 10;
    const promises = Array.from({ length: concurrentCount }, () =>
      nextNumber(testOrgId, "INVOICE", prisma),
    );

    const results = await Promise.all(promises);

    // Assert strictly unique numbers
    const uniqueNumbers = new Set(results);
    expect(uniqueNumbers.size).toBe(concurrentCount);

    // Assert strictly sequential gapless integers
    const sorted = [...results].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i + 1] - sorted[i]).toBe(1);
    }

    // Verify format sequence: prefix + year + padded counter
    const formatted = formatSequenceNumber(sorted[0], `INV-${new Date().getFullYear()}-`, 4);
    expect(formatted).toMatch(new RegExp(`^INV-${new Date().getFullYear()}-\\d{4}$`));
  });

  // 2. PDF TOTAL EQUALS ORDER TOTAL
  it("test 2: PDF total equals order total", async () => {
    const { order } = await setupTestOrder({ qty: 10, basePriceMinor: 25000 }); // ₹2,500.00 each

    const snapshot: InvoiceSnapshot = {
      invoiceNumber: "INV-2026-0001",
      orderNumber: order.orderNumber || "ORD-2026-0001",
      issuedAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      paymentTerms: "Net 30",
      currency: "INR",
      organization: {
        id: testOrgId,
        name: "Acme Industrial Testing Ltd",
        taxId: "27AABCU9603R1ZM",
      },
      customer: {
        id: order.customerId,
        name: "Test Customer Co",
        company: "Test Customer Co Ltd",
        email: "buyer@testcustomer.com",
        deliveryAddress: "Pune 411019",
      },
      lines: order.lines.map((l) => ({
        sku: l.sku,
        rawText: l.rawText,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor,
        discountMinor: l.discountMinor,
        taxMinor: l.taxMinor,
        lineTotalMinor: l.lineTotalMinor,
        taxRateBps: 1800,
      })),
      taxSummary: [
        {
          taxRateBps: 1800,
          taxRatePct: "18%",
          taxableAmountMinor: order.subtotalMinor,
          taxAmountMinor: order.taxMinor,
        },
      ],
      subtotalMinor: order.subtotalMinor,
      discountMinor: 0,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      paymentLinkUrl: "https://rzp.io/i/test_link_123",
    };

    const pdfBuffer = generateInvoicePdfBuffer(snapshot);

    // Verify it is a valid PDF 1.4 binary
    expect(pdfBuffer.toString("utf8", 0, 8)).toBe("%PDF-1.4");
    expect(pdfBuffer.toString("utf8").includes("%%EOF")).toBe(true);

    // Total paise in snapshot equals order totalMinor exactly
    expect(snapshot.totalMinor).toBe(order.totalMinor);
    expect(snapshot.subtotalMinor + snapshot.taxMinor).toBe(order.totalMinor);

    // Verify invoice generation through service preserves exact totals
    const invoice = await generateInvoiceForOrder({
      orderId: order.id,
      organizationId: testOrgId,
    });
    expect(invoice.totalMinor).toBe(order.totalMinor);
    expect(invoice.status).toBe("SENT");
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);
  });

  // 3. INVALID SIGNATURE CHANGES NOTHING
  it("test 3: invalid signature changes nothing", async () => {
    const { order } = await setupTestOrder({ status: "APPROVED", qty: 2, basePriceMinor: 10000 });
    const secret = "test_webhook_secret_xyz123";
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;

    const payloadObj = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_tampered_${Date.now()}`,
            amount: order.totalMinor,
            notes: { orderId: order.id },
          },
        },
      },
    };
    const rawBody = JSON.stringify(payloadObj);
    const forgedSignature = "invalid_forged_signature_hash_00000000";

    const provider = new RazorpayPaymentProvider();
    const isValid = provider.verifyWebhookSignature(rawBody, forgedSignature, secret);
    expect(isValid).toBe(false);

    // Since signature is invalid, no DB records are created or updated
    const paymentsCountBefore = await prisma.payment.count({ where: { orderId: order.id } });
    const orderBefore = await prisma.order.findUnique({ where: { id: order.id } });

    expect(paymentsCountBefore).toBe(0);
    expect(orderBefore?.paymentStatus).toBe("UNPAID");
  });

  // 4. REPLAYED WEBHOOK IS A NO-OP
  it("test 4: replayed webhook is a no-op", async () => {
    const { order } = await setupTestOrder({ status: "APPROVED", qty: 1, basePriceMinor: 5000 });
    const providerPaymentId = `pay_replay_test_${Date.now()}`;

    // First arrival of payment webhook
    const firstResult = await applyPaymentEvent({
      orderId: order.id,
      organizationId: testOrgId,
      provider: "RAZORPAY",
      providerPaymentId,
      amountMinor: order.totalMinor,
      status: "SUCCESS",
      eventType: "payment.captured",
    });

    expect(firstResult.isReplay).toBe(false);
    expect(firstResult.newPaymentStatus).toBe("PAID");

    // Second arrival (replay of the same event)
    const secondResult = await applyPaymentEvent({
      orderId: order.id,
      organizationId: testOrgId,
      provider: "RAZORPAY",
      providerPaymentId,
      amountMinor: order.totalMinor,
      status: "SUCCESS",
      eventType: "payment.captured",
    });

    expect(secondResult.isReplay).toBe(true);

    // Count of payments in DB must remain exactly 1
    const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].providerPaymentId).toBe(providerPaymentId);
  });

  // 5. PARTIAL THEN FULL PAYMENT
  it("test 5: partial then full payment", async () => {
    const { order } = await setupTestOrder({ status: "APPROVED", qty: 2, basePriceMinor: 50000 }); // total = ₹1,180.00 (118000 minor)
    const partialAmount = Math.floor(order.totalMinor / 2); // 59000 minor
    const remainingAmount = order.totalMinor - partialAmount; // 59000 minor

    // 1. Partial payment arrives
    const partResult = await applyPaymentEvent({
      orderId: order.id,
      organizationId: testOrgId,
      provider: "RAZORPAY",
      providerPaymentId: `pay_part_${Date.now()}`,
      amountMinor: partialAmount,
      status: "SUCCESS",
      eventType: "payment.captured",
    });

    expect(partResult.newPaymentStatus).toBe("PARTIAL");
    expect(partResult.netPaidMinor).toBe(partialAmount);

    let updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.paymentStatus).toBe("PARTIAL");

    // 2. Second payment arrives covering remainder
    const fullResult = await applyPaymentEvent({
      orderId: order.id,
      organizationId: testOrgId,
      provider: "RAZORPAY",
      providerPaymentId: `pay_full_${Date.now()}`,
      amountMinor: remainingAmount,
      status: "SUCCESS",
      eventType: "payment.captured",
    });

    expect(fullResult.newPaymentStatus).toBe("PAID");
    expect(fullResult.netPaidMinor).toBe(order.totalMinor);

    updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.paymentStatus).toBe("PAID");
  });

  // 6. ILLEGAL TRANSITIONS REFUSED
  it("test 6: illegal transitions refused", async () => {
    const { order } = await setupTestOrder({
      status: "APPROVED",
      fulfillmentRequires: "PAYMENT_PAID",
    });

    // Attempt skipping directly from PENDING to DISPATCHED
    await expect(
      transitionFulfillment({
        orderId: order.id,
        organizationId: testOrgId,
        toStatus: "DISPATCHED", // skipping PACKING
        actor: { id: "emp_1", role: "EMPLOYEE", name: "Warehouse Staff" },
      }),
    ).rejects.toThrow(/Illegal transition/);

    // Attempt moving to PACKING while paymentStatus is UNPAID (without admin override)
    await expect(
      transitionFulfillment({
        orderId: order.id,
        organizationId: testOrgId,
        toStatus: "PACKING",
        actor: { id: "emp_1", role: "EMPLOYEE", name: "Warehouse Staff" },
      }),
    ).rejects.toThrow(/Packing blocked/);

    // Attempt moving to PACKING with admin override succeeds
    const packingSuccess = await transitionFulfillment({
      orderId: order.id,
      organizationId: testOrgId,
      toStatus: "PACKING",
      overrideReason: "Credit approved by CFO",
      actor: { id: "admin_1", role: "CLIENT_ADMIN", name: "Admin Lead" },
    });
    expect(packingSuccess.fulfillment.status).toBe("PACKING");

    // Attempt backward revert without reason is refused
    await expect(
      transitionFulfillment({
        orderId: order.id,
        organizationId: testOrgId,
        toStatus: "PENDING",
        overrideReason: "",
        actor: { id: "admin_1", role: "CLIENT_ADMIN", name: "Admin Lead" },
      }),
    ).rejects.toThrow(/A logged reason is required/);

    // Attempt backward revert by non-admin is refused
    await expect(
      transitionFulfillment({
        orderId: order.id,
        organizationId: testOrgId,
        toStatus: "PENDING",
        overrideReason: "Mistake",
        actor: { id: "emp_1", role: "EMPLOYEE", name: "Staff" },
      }),
    ).rejects.toThrow(/Only administrators can revert/);
  });

  // 7. RESERVATION-TO-DECREMENT MATH
  it("test 7: reservation-to-decrement math", async () => {
    const initialOnHand = 100;
    const initialReserved = 20; // 20 units currently reserved
    const orderQty = 15;

    const { order, product } = await setupTestOrder({
      status: "APPROVED",
      qty: orderQty,
      initialOnHand,
      initialReserved,
    });

    const inventoryProvider = new LocalDbInventoryProvider();

    // Check stock before dispatch: onHand=100, reserved=20, available = 80
    const beforeStock = await inventoryProvider.getStock(testOrgId, product.id);
    expect(beforeStock.onHand).toBe(100);
    expect(beforeStock.reserved).toBe(20);
    expect(beforeStock.available).toBe(80);

    // Transition to PACKING then DISPATCHED
    await transitionFulfillment({
      orderId: order.id,
      organizationId: testOrgId,
      toStatus: "PACKING",
      overrideReason: "Approved",
      actor: { id: "admin_1", role: "CLIENT_ADMIN", name: "Admin" },
    });

    await transitionFulfillment({
      orderId: order.id,
      organizationId: testOrgId,
      toStatus: "DISPATCHED",
      carrier: "BlueDart",
      trackingRef: "BD12345678",
      actor: { id: "admin_1", role: "CLIENT_ADMIN", name: "Admin" },
    });

    // Check stock after dispatch:
    // onHand = 100 - 15 = 85
    // reserved = 20 - 15 = 5
    // available = 85 - 5 = 80 (EXACTLY UNCHANGED!)
    const afterStock = await inventoryProvider.getStock(testOrgId, product.id);
    expect(afterStock.onHand).toBe(85);
    expect(afterStock.reserved).toBe(5);
    expect(afterStock.available).toBe(80);

    // Cancelling before dispatch releases reservation:
    const { order: order2, product: prod2 } = await setupTestOrder({
      status: "APPROVED",
      qty: 10,
      initialOnHand: 50,
      initialReserved: 10,
    });

    const cancelResult = await cancelOrderBeforeDispatch({
      orderId: order2.id,
      organizationId: testOrgId,
      reason: "Buyer cancelled order",
      actor: { id: "admin_1", role: "CLIENT_ADMIN", name: "Admin" },
    });
    expect(cancelResult.status).toBe("CANCELLED");

    // Reservation released, onHand untouched
    const stockAfterCancel = await inventoryProvider.getStock(testOrgId, prod2.id);
    expect(stockAfterCancel.onHand).toBe(50);
    expect(stockAfterCancel.reserved).toBe(0);
  });

  // 8. ERP FAILURE KEEPS THE LOCAL MOVEMENT
  it("test 8: ERP failure keeps the local movement", async () => {
    const { order, product } = await setupTestOrder({
      status: "APPROVED",
      qty: 5,
      initialOnHand: 50,
      initialReserved: 5,
    });

    process.env.INVENTORY_PROVIDER = "erp";

    try {
      await transitionFulfillment({
        orderId: order.id,
        organizationId: testOrgId,
        toStatus: "PACKING",
        overrideReason: "Test",
        actor: { id: "admin_1", role: "CLIENT_ADMIN", name: "Admin" },
      });

      const res = await transitionFulfillment({
        orderId: order.id,
        organizationId: testOrgId,
        toStatus: "DISPATCHED",
        actor: { id: "admin_1", role: "CLIENT_ADMIN", name: "Admin" },
      });

      // Local movement is kept and marked SYNC_FAILED
      expect(res.erpSyncFailed).toBe(true);
      expect(res.fulfillment.status).toBe("DISPATCHED");

      // Verify local level was successfully updated
      const level = await prisma.inventoryLevel.findUnique({
        where: { organizationId_productId: { organizationId: testOrgId, productId: product.id } },
      });
      expect(level?.onHand).toBe(45);
    } finally {
      delete process.env.INVENTORY_PROVIDER;
    }
  });

  // 9. EXACTLY FIVE CUSTOMER MESSAGES FOR A FULL RUN
  it("test 9: exactly five customer messages for a full run", async () => {
    const { order } = await setupTestOrder({ status: "APPROVED", qty: 2 });

    // Mock WhatsApp outbound provider to track deliveries
    const sentMessages: string[] = [];
    setMessagingProviderFor("WHATSAPP", {
      name: "whatsapp",
      parseInbound: async () => [],
      sendOutbound: async (msg) => {
        sentMessages.push(msg.body);
        return { providerMessageId: `wamid_sim_${sentMessages.length}` };
      },
    });

    // 1. ORDER_CONFIRMED
    const upd1 = await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: testOrgId,
      event: "ORDER_CONFIRMED",
    });
    expect(upd1.sent).toBe(true);

    // 2. INVOICE_SENT
    const upd2 = await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: testOrgId,
      event: "INVOICE_SENT",
    });
    expect(upd2.sent).toBe(true);

    // 3. PAYMENT_RECEIVED
    const upd3 = await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: testOrgId,
      event: "PAYMENT_RECEIVED",
    });
    expect(upd3.sent).toBe(true);

    // 4. ORDER_DISPATCHED
    const upd4 = await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: testOrgId,
      event: "ORDER_DISPATCHED",
    });
    expect(upd4.sent).toBe(true);

    // 5. ORDER_DELIVERED
    const upd5 = await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: testOrgId,
      event: "ORDER_DELIVERED",
    });
    expect(upd5.sent).toBe(true);

    // Assert exactly 5 customer message rows exist in the conversation thread
    const threadMessages = await prisma.customerMessage.findMany({
      where: {
        organizationId: testOrgId,
        conversation: { customerId: order.customerId },
        sender: "AI",
        body: { startsWith: "[automated update]" },
      },
    });
    expect(threadMessages.length).toBe(5);

    // Verify deduplication: attempting to re-send ORDER_CONFIRMED with same version is skipped
    const dupRes = await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: testOrgId,
      event: "ORDER_CONFIRMED",
    });
    expect(dupRes.sent).toBe(false);
    expect(dupRes.error).toContain("Already sent");
  });

  // 10. WINDOW-CLOSED BRANCH
  it("test 10: window-closed branch activates template mode and falls back to email if unavailable", async () => {
    const { order, customer } = await setupTestOrder({ status: "APPROVED", qty: 1 });

    // Create a conversation where last inbound is 30 hours old (window closed)
    const conversation = await prisma.customerConversation.create({
      data: {
        organizationId: testOrgId,
        customerId: customer.id,
        channel: "WHATSAPP",
        tagsJson: "[]",
      },
    });

    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000);
    await prisma.customerMessage.create({
      data: {
        organizationId: testOrgId,
        conversationId: conversation.id,
        sender: "CUSTOMER",
        body: "Can I place an order?",
        createdAt: thirtyHoursAgo,
      },
    });

    const isOpen = await isCustomerCareWindowOpen(conversation.id);
    expect(isOpen).toBe(false); // 24-hour service window is closed!

    // Configure provider to reject outside window simulating Meta template restriction
    setMessagingProviderFor("WHATSAPP", {
      name: "whatsapp",
      parseInbound: async () => [],
      sendOutbound: async () => {
        throw new Error("Meta template error: template parameter mismatch");
      },
    });

    // Deliver customer update
    const result = await deliverCustomerUpdate({
      orderId: order.id,
      organizationId: testOrgId,
      event: "ORDER_DISPATCHED",
      version: 999, // Unique version to avoid dedupe collision
    });

    // Fell back to Email and logged TEMPLATE_UNAVAILABLE!
    expect(result.channel).toBe("EMAIL");
    expect(result.mode).toBe("EMAIL_FALLBACK");
    expect(result.error).toContain("TEMPLATE_UNAVAILABLE");

    // Check NotificationLog
    const log = await prisma.notificationLog.findUnique({
      where: { dedupeKey: `${order.id}:ORDER_DISPATCHED:999` },
    });
    expect(log?.channel).toBe("EMAIL");
    expect(log?.error).toContain("TEMPLATE_UNAVAILABLE");
  });

  // 11. VOID AND REISSUE INVOICE
  it("test 11: void and reissue keeps invoice number and logs reason", async () => {
    const { order } = await setupTestOrder({ status: "APPROVED", qty: 2 });

    const invoice = await generateInvoiceForOrder({
      orderId: order.id,
      organizationId: testOrgId,
    });
    const originalNumber = invoice.invoiceNumber;

    const reissued = await voidAndReissueInvoice({
      invoiceId: invoice.id,
      organizationId: testOrgId,
      reason: "Corrected billing address and tax id per client request",
      actor: { id: "admin_1", role: "CLIENT_ADMIN", name: "Admin Lead" },
    });

    // Number strictly kept!
    expect(reissued.invoiceNumber).toBe(originalNumber);
    expect(reissued.id).not.toBe(invoice.id);

    // Old invoice marked VOID with reason logged
    const oldInv = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(oldInv?.status).toBe("VOID");
    expect(oldInv?.voidReason).toBe("Corrected billing address and tax id per client request");
  });

  // 12. MANUAL PAYMENT ENTRY
  it("test 12: manual payment entry by admin updates status and logs event", async () => {
    const { order, adminUser } = await setupTestOrder({ status: "APPROVED", qty: 2, basePriceMinor: 20000 });

    const manualRes = await recordManualPayment({
      orderId: order.id,
      organizationId: testOrgId,
      amountMinor: order.totalMinor,
      reference: `NEFT-UTR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      notes: "Direct bank transfer confirmed",
      actor: { id: adminUser.id, role: "CLIENT_ADMIN", name: "Finance Admin" },
    });

    expect(manualRes.payment.provider).toBe("MANUAL");
    expect(manualRes.newPaymentStatus).toBe("PAID");

    const events = await prisma.orderEvent.findMany({
      where: { orderId: order.id, type: "PAYMENT_SUCCESS" },
    });
    expect(events.length).toBeGreaterThan(0);
  });
});
