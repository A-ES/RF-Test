import { prisma } from "@/app/lib/db";
import { nextNumber } from "@rf-intelligence/db";
import { assertOrderApproved, OrderOperationError } from "@/app/lib/orders/order-service";
import { getPaymentProvider } from "@/app/lib/payments/provider";
import {
  generateInvoicePdfBuffer,
  storeInvoicePdf,
  type InvoiceSnapshot,
  type InvoiceTaxSummaryItem,
} from "@/app/lib/invoices/pdf";
import { createPresignedDownload, isStorageConfigured } from "@/app/lib/storage";
import { writeAuditLog } from "@/app/lib/audit";
import { deliverCustomerUpdate } from "@/app/lib/messaging/customer-updates";
import type { Prisma } from "@prisma/client";

export interface GenerateInvoiceParams {
  orderId: string;
  organizationId: string;
  client?: Prisma.TransactionClient;
  actorId?: string;
}

/**
 * Generates an official gapless sequential Invoice for an approved Order.
 * Enforces assertOrderApproved.
 * Idempotent: If an active (non-VOID) invoice already exists for the order, returns it.
 */
export async function generateInvoiceForOrder(params: GenerateInvoiceParams) {
  const db = params.client ?? prisma;

  // 1. Fetch order with details
  const order = await db.order.findFirst({
    where: { id: params.orderId, organizationId: params.organizationId },
    include: {
      lines: {
        include: { product: true },
      },
      customer: true,
      invoices: {
        where: { status: { not: "VOID" } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!order) {
    throw new OrderOperationError("Order not found", "NOT_FOUND");
  }

  // Non-negotiable server guard: invoice cannot be generated unless APPROVED
  assertOrderApproved(order);

  // Idempotency: Return existing non-void invoice if present
  if (order.invoices.length > 0 && order.invoices[0]) {
    return order.invoices[0];
  }

  // 2. Fetch org settings
  const settings = await db.organizationSettings.findUnique({
    where: { organizationId: params.organizationId },
    include: { organization: true },
  });

  const orgName = settings?.organization?.name || "RF Intelligence";
  const orgPrefix = settings?.invoicePrefix || "INV-";
  const cleanPrefix = orgPrefix.endsWith("-") ? orgPrefix : `${orgPrefix}-`;
  const paymentTermsDays = order.customer.paymentTermsDays ?? settings?.paymentTermsDays ?? 30;
  const paymentsEnabled = settings?.paymentsEnabled ?? true;
  const currency = order.currency || settings?.currency || "INR";

  // 3. Allocate gapless sequential counter
  const seq = await nextNumber(params.organizationId, "INVOICE", db);
  const year = new Date().getFullYear();
  const invoiceNumber = `${cleanPrefix}${year}-${seq.toString().padStart(4, "0")}`;

  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);
  const paymentTerms = `Net ${paymentTermsDays}`;

  // 4. Compute Tax by Rate Summary
  const taxMap = new Map<number, { taxableMinor: number; taxMinor: number }>();
  for (const line of order.lines) {
    const rateBps = line.product?.taxRateBps ?? settings?.defaultTaxBps ?? 1800;
    const existing = taxMap.get(rateBps) ?? { taxableMinor: 0, taxMinor: 0 };
    existing.taxableMinor += (line.lineTotalMinor - line.taxMinor);
    existing.taxMinor += line.taxMinor;
    taxMap.set(rateBps, existing);
  }

  const taxSummary: InvoiceTaxSummaryItem[] = Array.from(taxMap.entries()).map(([rateBps, totals]) => ({
    taxRateBps: rateBps,
    taxRatePct: `${(rateBps / 100).toFixed(rateBps % 100 === 0 ? 0 : 1)}%`,
    taxableAmountMinor: totals.taxableMinor,
    taxAmountMinor: totals.taxMinor,
  }));

  // 5. Payment Link creation
  let paymentLinkUrl: string | null = null;
  let paymentLinkId: string | null = null;
  const paymentProvider = getPaymentProvider(paymentsEnabled);

  if (paymentsEnabled) {
    try {
      const linkResult = await paymentProvider.createPaymentLink({
        amountMinor: order.totalMinor,
        currency,
        orderId: order.id,
        orderNumber: order.orderNumber || order.draftNumber,
        customer: {
          name: order.customer.name,
          email: order.customer.email,
          phone: order.customer.whatsapp || order.customer.phone,
        },
        description: `Invoice ${invoiceNumber} for Order ${order.orderNumber || order.draftNumber}`,
      });
      paymentLinkUrl = linkResult.url;
      paymentLinkId = linkResult.id;
    } catch (payErr) {
      console.warn("Payment link generation failed; proceeding with payment on terms:", payErr);
    }
  }

  // 6. Build snapshot
  const snapshot: InvoiceSnapshot = {
    invoiceNumber,
    orderNumber: order.orderNumber || order.draftNumber,
    issuedAt: issuedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    paymentTerms,
    currency,
    organization: {
      id: params.organizationId,
      name: orgName,
      taxId: settings?.taxId ?? null,
      logoUrl: settings?.logoUrl ?? null,
    },
    customer: {
      id: order.customer.id,
      name: order.customer.name,
      company: order.customer.company ?? null,
      email: order.customer.email ?? null,
      phone: order.customer.whatsapp || order.customer.phone || null,
      taxId: order.customer.taxId ?? null,
      deliveryAddress: order.deliveryAddress ?? null,
    },
    lines: order.lines.map((l) => ({
      sku: l.sku,
      rawText: l.rawText,
      qty: l.qty,
      unitPriceMinor: l.unitPriceMinor,
      discountMinor: l.discountMinor,
      taxMinor: l.taxMinor,
      lineTotalMinor: l.lineTotalMinor,
      taxRateBps: l.product?.taxRateBps ?? settings?.defaultTaxBps ?? 1800,
    })),
    taxSummary,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
    paymentLinkUrl,
    paymentTermsNote: paymentsEnabled ? null : `Payment on terms: ${paymentTerms}. Remit via bank transfer.`,
  };

  // 7. Generate server-side PDF and store in private bucket
  const pdfBuffer = generateInvoicePdfBuffer(snapshot);
  const storedPdf = await storeInvoicePdf({
    organizationId: params.organizationId,
    invoiceNumber,
    pdfBuffer,
  });

  // 8. Persist Invoice row
  const invoice = await db.invoice.create({
    data: {
      organizationId: params.organizationId,
      orderId: order.id,
      invoiceNumber,
      status: "SENT",
      issuedAt,
      dueAt,
      paymentTerms,
      pdfPath: storedPdf.pdfPath,
      paymentLinkUrl: paymentLinkUrl || storedPdf.signedUrl,
      paymentLinkId,
      totalMinor: order.totalMinor,
      snapshotJson: JSON.stringify(snapshot),
    },
  });

  // 9. Record OrderEvent
  await db.orderEvent.create({
    data: {
      orderId: order.id,
      organizationId: params.organizationId,
      actorId: params.actorId ?? null,
      actorKind: params.actorId ? "EMPLOYEE" : "SYSTEM",
      type: "INVOICE_GENERATED",
      fromStatus: order.status,
      toStatus: order.status,
      payloadJson: JSON.stringify({
        invoiceId: invoice.id,
        invoiceNumber,
        totalMinor: order.totalMinor,
        pdfPath: storedPdf.pdfPath,
        paymentLinkUrl,
      }),
    },
  });

  return invoice;
}

/**
 * Admin action: 'Void and reissue' an invoice.
 * Requirement: The original invoiceNumber is KEPT, and the reason is logged.
 */
export async function voidAndReissueInvoice(params: {
  invoiceId: string;
  organizationId: string;
  reason: string;
  actor: { id: string; role: string; name: string };
}) {
  if (!params.reason || params.reason.trim().length === 0) {
    throw new OrderOperationError("A void reason is required", "REASON_REQUIRED");
  }

  const existing = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
    include: {
      order: {
        include: {
          customer: true,
          lines: { include: { product: true } },
        },
      },
    },
  });

  if (!existing) {
    throw new OrderOperationError("Invoice not found", "NOT_FOUND");
  }

  const order = existing.order;
  assertOrderApproved(order);

  // Mark existing invoice as VOID
  await prisma.invoice.update({
    where: { id: existing.id },
    data: {
      status: "VOID",
      voidReason: params.reason.trim(),
    },
  });

  // Keep the exact same invoice number for reissue!
  const invoiceNumber = existing.invoiceNumber;
  const issuedAt = new Date();
  const paymentTermsDays = order.customer.paymentTermsDays ?? 30;
  const dueAt = new Date(issuedAt.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: params.organizationId },
    include: { organization: true },
  });

  const orgName = settings?.organization?.name || "RF Intelligence";

  // Rebuild snapshot
  const taxMap = new Map<number, { taxableMinor: number; taxMinor: number }>();
  for (const line of order.lines) {
    const rateBps = line.product?.taxRateBps ?? settings?.defaultTaxBps ?? 1800;
    const item = taxMap.get(rateBps) ?? { taxableMinor: 0, taxMinor: 0 };
    item.taxableMinor += (line.lineTotalMinor - line.taxMinor);
    item.taxMinor += line.taxMinor;
    taxMap.set(rateBps, item);
  }

  const taxSummary: InvoiceTaxSummaryItem[] = Array.from(taxMap.entries()).map(([rateBps, totals]) => ({
    taxRateBps: rateBps,
    taxRatePct: `${(rateBps / 100).toFixed(rateBps % 100 === 0 ? 0 : 1)}%`,
    taxableAmountMinor: totals.taxableMinor,
    taxAmountMinor: totals.taxMinor,
  }));

  const snapshot: InvoiceSnapshot = {
    invoiceNumber,
    orderNumber: order.orderNumber || order.draftNumber,
    issuedAt: issuedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    paymentTerms: existing.paymentTerms,
    currency: order.currency,
    organization: {
      id: params.organizationId,
      name: orgName,
      taxId: settings?.taxId ?? null,
      logoUrl: settings?.logoUrl ?? null,
    },
    customer: {
      id: order.customer.id,
      name: order.customer.name,
      company: order.customer.company ?? null,
      email: order.customer.email ?? null,
      phone: order.customer.whatsapp || order.customer.phone || null,
      taxId: order.customer.taxId ?? null,
      deliveryAddress: order.deliveryAddress ?? null,
    },
    lines: order.lines.map((l) => ({
      sku: l.sku,
      rawText: l.rawText,
      qty: l.qty,
      unitPriceMinor: l.unitPriceMinor,
      discountMinor: l.discountMinor,
      taxMinor: l.taxMinor,
      lineTotalMinor: l.lineTotalMinor,
      taxRateBps: l.product?.taxRateBps ?? 1800,
    })),
    taxSummary,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
    paymentLinkUrl: existing.paymentLinkUrl,
  };

  // Re-generate PDF
  const pdfBuffer = generateInvoicePdfBuffer(snapshot);
  const storedPdf = await storeInvoicePdf({
    organizationId: params.organizationId,
    invoiceNumber: `${invoiceNumber}_reissued`,
    pdfBuffer,
  });

  // Create reissued invoice with the SAME invoiceNumber
  // To satisfy unique constraint @@unique([organizationId, invoiceNumber]),
  // we update the voided invoice number with suffix "_VOID" so the official reissued invoice retains the original number
  await prisma.invoice.update({
    where: { id: existing.id },
    data: {
      invoiceNumber: `${invoiceNumber}_VOID_${Date.now()}`,
    },
  });

  const reissued = await prisma.invoice.create({
    data: {
      organizationId: params.organizationId,
      orderId: order.id,
      invoiceNumber, // Number kept!
      status: "SENT",
      issuedAt,
      dueAt,
      paymentTerms: existing.paymentTerms,
      pdfPath: storedPdf.pdfPath,
      paymentLinkUrl: existing.paymentLinkUrl,
      paymentLinkId: existing.paymentLinkId,
      totalMinor: order.totalMinor,
      snapshotJson: JSON.stringify(snapshot),
    },
  });

  // Log in OrderEvent & AdminAuditLog
  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      organizationId: params.organizationId,
      actorId: params.actor.id,
      actorKind: "EMPLOYEE",
      type: "INVOICE_VOID_AND_REISSUED",
      fromStatus: order.status,
      toStatus: order.status,
      payloadJson: JSON.stringify({
        previousInvoiceId: existing.id,
        newInvoiceId: reissued.id,
        invoiceNumber,
        reason: params.reason.trim(),
        actorName: params.actor.name,
      }),
    },
  });

  await writeAuditLog({
    organizationId: params.organizationId,
    userId: params.actor.id,
    action: "invoice.void_and_reissue",
    entityType: "Invoice",
    entityId: reissued.id,
    metadata: {
      invoiceNumber,
      reason: params.reason.trim(),
      orderId: order.id,
    },
  });

  return reissued;
}

/**
 * Gets a fresh signed download URL for an invoice PDF.
 */
export async function getInvoiceSignedDownloadUrl(invoiceId: string, organizationId: string): Promise<string> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
  });

  if (!invoice || !invoice.pdfPath) {
    throw new OrderOperationError("Invoice or PDF not found", "NOT_FOUND");
  }

  if (isStorageConfigured()) {
    return createPresignedDownload({
      key: invoice.pdfPath,
      filename: `${invoice.invoiceNumber}.pdf`,
      expiresIn: 3600, // 1 hour download link
    });
  }

  return invoice.paymentLinkUrl || `https://private-bucket.internal/${invoice.pdfPath}`;
}

/**
 * Resends an existing invoice notification to the customer.
 */
export async function resendInvoiceNotification(params: {
  invoiceId: string;
  organizationId: string;
  actor: { id: string; role: string; name: string };
}) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
    include: { order: true },
  });

  if (!invoice) {
    throw new OrderOperationError("Invoice not found", "NOT_FOUND");
  }

  // Trigger customer notification delivery for INVOICE_SENT
  await deliverCustomerUpdate({
    orderId: invoice.orderId,
    organizationId: params.organizationId,
    event: "INVOICE_SENT",
    version: invoice.order.version + 1, // bump to bypass dedupe on explicit resend
    extraData: {
      invoiceNumber: invoice.invoiceNumber,
      paymentLink: invoice.paymentLinkUrl,
    },
  });

  await writeAuditLog({
    organizationId: params.organizationId,
    userId: params.actor.id,
    action: "invoice.resend",
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      orderId: invoice.orderId,
    },
  });

  return { success: true, invoiceNumber: invoice.invoiceNumber };
}
