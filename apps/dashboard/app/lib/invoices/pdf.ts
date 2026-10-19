import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getStorageConfig, isStorageConfigured, createPresignedDownload } from "@/app/lib/storage";
import { getMediaStorageBucket } from "@/app/lib/messaging/transcriber";
import { formatMinorUnits } from "@/app/lib/orders/money";

export interface InvoiceSnapshotLine {
  sku: string;
  rawText: string;
  qty: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
  taxRateBps?: number;
}

export interface InvoiceTaxSummaryItem {
  taxRateBps: number;
  taxRatePct: string;
  taxableAmountMinor: number;
  taxAmountMinor: number;
}

export interface InvoiceSnapshot {
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: string;
  dueAt: string;
  paymentTerms: string;
  currency: string;
  organization: {
    id: string;
    name: string;
    taxId?: string | null;
    logoUrl?: string | null;
  };
  customer: {
    id: string;
    name: string;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    taxId?: string | null;
    deliveryAddress?: string | null;
  };
  lines: InvoiceSnapshotLine[];
  taxSummary: InvoiceTaxSummaryItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paymentLinkUrl?: string | null;
  paymentTermsNote?: string | null;
}

/**
 * Escapes characters for PDF literal text strings.
 */
function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/[^\x20-\x7E]/g, "?"); // Keep printable ASCII for standard PDF Helvetica
}

/**
 * Generates a valid PDF 1.4 document binary buffer containing the complete invoice.
 */
export function generateInvoicePdfBuffer(snapshot: InvoiceSnapshot): Buffer {
  const objects: string[] = [];

  const addObject = (content: string) => {
    objects.push(content);
    return objects.length; // 1-indexed object id
  };

  // Obj 1: Catalog
  // Obj 2: Outlines
  // Obj 3: Pages
  // Obj 4: Page 1
  // Obj 5: Font Helvetica
  // Obj 6: Font Helvetica-Bold
  // Obj 7: Content stream

  const contentOps: string[] = [];

  // Colors
  // Primary dark blue: 0.1 0.18 0.36
  // Accent slate: 0.4 0.45 0.55
  // Light bg: 0.95 0.96 0.98
  // Border: 0.85 0.87 0.9

  // Header Background Banner
  contentOps.push("0.1 0.18 0.36 rg");
  contentOps.push("0 720 595 122 re f");

  // Header Title
  contentOps.push("BT");
  contentOps.push("/F2 22 Tf");
  contentOps.push("1 1 1 rg"); // White
  contentOps.push("40 790 Td");
  contentOps.push(`(${escapePdfText(snapshot.organization.name)}) Tj`);
  contentOps.push("ET");

  // Org Tax ID
  if (snapshot.organization.taxId) {
    contentOps.push("BT");
    contentOps.push("/F1 10 Tf");
    contentOps.push("0.8 0.85 0.95 rg");
    contentOps.push("40 770 Td");
    contentOps.push(`(GSTIN / Tax ID: ${escapePdfText(snapshot.organization.taxId)}) Tj`);
    contentOps.push("ET");
  }

  // Invoice Big Label
  contentOps.push("BT");
  contentOps.push("/F2 20 Tf");
  contentOps.push("1 1 1 rg");
  contentOps.push("420 790 Td");
  contentOps.push("(TAX INVOICE) Tj");
  contentOps.push("ET");

  // Invoice Number & Date
  contentOps.push("BT");
  contentOps.push("/F1 10 Tf");
  contentOps.push("0.9 0.9 0.95 rg");
  contentOps.push("420 772 Td");
  contentOps.push(`(${escapePdfText(snapshot.invoiceNumber)}) Tj`);
  contentOps.push("0 -14 Td");
  contentOps.push(`(Date: ${escapePdfText(snapshot.issuedAt.slice(0, 10))}) Tj`);
  contentOps.push("0 -14 Td");
  contentOps.push(`(Due: ${escapePdfText(snapshot.dueAt.slice(0, 10))}) Tj`);
  contentOps.push("ET");

  // Bill To Box
  contentOps.push("0.96 0.97 0.98 rg");
  contentOps.push("40 625 250 80 re f");
  contentOps.push("0.85 0.87 0.9 RG");
  contentOps.push("0.5 w");
  contentOps.push("40 625 250 80 re S");

  contentOps.push("BT");
  contentOps.push("/F2 10 Tf");
  contentOps.push("0.2 0.25 0.35 rg");
  contentOps.push("50 690 Td");
  contentOps.push("(BILLED TO:) Tj");
  contentOps.push("/F2 11 Tf");
  contentOps.push("0 0 0 rg");
  contentOps.push("0 -14 Td");
  contentOps.push(`(${escapePdfText(snapshot.customer.company || snapshot.customer.name)}) Tj`);
  contentOps.push("/F1 9 Tf");
  contentOps.push("0.3 0.3 0.3 rg");
  if (snapshot.customer.company && snapshot.customer.name) {
    contentOps.push("0 -12 Td");
    contentOps.push(`(Attn: ${escapePdfText(snapshot.customer.name)}) Tj`);
  }
  if (snapshot.customer.taxId) {
    contentOps.push("0 -12 Td");
    contentOps.push(`(Tax ID: ${escapePdfText(snapshot.customer.taxId)}) Tj`);
  }
  if (snapshot.customer.phone || snapshot.customer.email) {
    contentOps.push("0 -12 Td");
    const contact = [snapshot.customer.phone, snapshot.customer.email].filter(Boolean).join(" | ");
    contentOps.push(`(${escapePdfText(contact)}) Tj`);
  }
  contentOps.push("ET");

  // Order Details Box
  contentOps.push("0.96 0.97 0.98 rg");
  contentOps.push("305 625 250 80 re f");
  contentOps.push("0.85 0.87 0.9 RG");
  contentOps.push("305 625 250 80 re S");

  contentOps.push("BT");
  contentOps.push("/F2 10 Tf");
  contentOps.push("0.2 0.25 0.35 rg");
  contentOps.push("315 690 Td");
  contentOps.push("(ORDER & PAYMENT DETAILS:) Tj");
  contentOps.push("/F1 9 Tf");
  contentOps.push("0.2 0.2 0.2 rg");
  contentOps.push("0 -14 Td");
  contentOps.push(`(Order Ref: ${escapePdfText(snapshot.orderNumber)}) Tj`);
  contentOps.push("0 -12 Td");
  contentOps.push(`(Terms: ${escapePdfText(snapshot.paymentTerms)}) Tj`);
  if (snapshot.customer.deliveryAddress) {
    contentOps.push("0 -12 Td");
    contentOps.push(`(Ship To: ${escapePdfText(snapshot.customer.deliveryAddress.slice(0, 36))}) Tj`);
  }
  contentOps.push("ET");

  // Line Items Table Header
  let y = 590;
  contentOps.push("0.1 0.18 0.36 rg");
  contentOps.push(`40 ${y} 515 20 re f`);

  contentOps.push("BT");
  contentOps.push("/F2 9 Tf");
  contentOps.push("1 1 1 rg");
  contentOps.push(`45 ${y + 6} Td (ITEM / SKU) Tj`);
  contentOps.push("175 0 Td (DESCRIPTION) Tj");
  contentOps.push("120 0 Td (QTY) Tj");
  contentOps.push("50 0 Td (UNIT PRICE) Tj");
  contentOps.push("75 0 Td (TOTAL) Tj");
  contentOps.push("ET");

  // Line Rows
  y -= 20;
  for (const line of snapshot.lines.slice(0, 15)) {
    contentOps.push("0.92 0.94 0.96 RG");
    contentOps.push("0.5 w");
    contentOps.push(`40 ${y} m 555 ${y} l S`);

    contentOps.push("BT");
    contentOps.push("/F2 9 Tf");
    contentOps.push("0 0 0 rg");
    contentOps.push(`45 ${y + 5} Td (${escapePdfText(line.sku)}) Tj`);

    contentOps.push("/F1 8 Tf");
    contentOps.push("0.2 0.2 0.2 rg");
    contentOps.push(`175 0 Td (${escapePdfText(line.rawText.slice(0, 26))}) Tj`);
    contentOps.push(`125 0 Td (${line.qty}) Tj`);
    contentOps.push(`45 0 Td (${escapePdfText(formatMinorUnits(line.unitPriceMinor, snapshot.currency))}) Tj`);
    contentOps.push("/F2 9 Tf");
    contentOps.push(`75 0 Td (${escapePdfText(formatMinorUnits(line.lineTotalMinor, snapshot.currency))}) Tj`);
    contentOps.push("ET");

    y -= 20;
  }

  // Summary and Tax Box
  y -= 10;
  const summaryBoxTop = y;

  // Tax breakdown on left
  contentOps.push("BT");
  contentOps.push("/F2 9 Tf");
  contentOps.push("0.2 0.2 0.35 rg");
  contentOps.push(`45 ${y} Td (TAX BREAKDOWN BY RATE:) Tj`);
  contentOps.push("ET");

  let taxY = y - 14;
  for (const taxItem of snapshot.taxSummary) {
    contentOps.push("BT");
    contentOps.push("/F1 8 Tf");
    contentOps.push("0.3 0.3 0.3 rg");
    contentOps.push(`45 ${taxY} Td`);
    contentOps.push(
      `(${escapePdfText(taxItem.taxRatePct)} GST on ${escapePdfText(formatMinorUnits(taxItem.taxableAmountMinor, snapshot.currency))}: ${escapePdfText(formatMinorUnits(taxItem.taxAmountMinor, snapshot.currency))}) Tj`,
    );
    contentOps.push("ET");
    taxY -= 12;
  }

  // Totals block on right
  const totalsX = 360;
  contentOps.push("BT");
  contentOps.push("/F1 9 Tf");
  contentOps.push("0.3 0.3 0.3 rg");
  contentOps.push(`${totalsX} ${summaryBoxTop} Td (Subtotal:) Tj`);
  contentOps.push(`90 0 Td (${escapePdfText(formatMinorUnits(snapshot.subtotalMinor, snapshot.currency))}) Tj`);

  if (snapshot.discountMinor > 0) {
    contentOps.push("-90 -14 Td (Discount:) Tj");
    contentOps.push(`90 0 Td (-${escapePdfText(formatMinorUnits(snapshot.discountMinor, snapshot.currency))}) Tj`);
  }

  contentOps.push("-90 -14 Td (Tax Total:) Tj");
  contentOps.push(`90 0 Td (${escapePdfText(formatMinorUnits(snapshot.taxMinor, snapshot.currency))}) Tj`);

  contentOps.push("/F2 11 Tf");
  contentOps.push("0.1 0.18 0.36 rg");
  contentOps.push("-90 -18 Td (TOTAL DUE:) Tj");
  contentOps.push(`90 0 Td (${escapePdfText(formatMinorUnits(snapshot.totalMinor, snapshot.currency))}) Tj`);
  contentOps.push("ET");

  // Payment Link & Instructions footer
  contentOps.push("0.96 0.97 0.98 rg");
  contentOps.push("40 80 515 70 re f");
  contentOps.push("0.85 0.87 0.9 RG");
  contentOps.push("40 80 515 70 re S");

  contentOps.push("BT");
  contentOps.push("/F2 10 Tf");
  contentOps.push("0.1 0.18 0.36 rg");
  contentOps.push("50 132 Td (PAYMENT INSTRUCTIONS:) Tj");
  contentOps.push("/F1 8 Tf");
  contentOps.push("0.2 0.2 0.2 rg");
  if (snapshot.paymentLinkUrl) {
    contentOps.push("0 -14 Td");
    contentOps.push(`(Pay securely online via UPI / Cards: ${escapePdfText(snapshot.paymentLinkUrl)}) Tj`);
  } else {
    contentOps.push("0 -14 Td");
    contentOps.push(`(${escapePdfText(snapshot.paymentTermsNote || "Payment on approved terms. Remit to registered company bank account.")}) Tj`);
  }
  contentOps.push("0 -12 Td");
  contentOps.push(`(Questions? Contact ${escapePdfText(snapshot.organization.name)} billing support.) Tj`);
  contentOps.push("ET");

  const streamData = contentOps.join("\n");
  const streamLength = Buffer.byteLength(streamData, "utf8");

  // Build standard PDF objects
  // 1: Catalog
  addObject("<< /Type /Catalog /Pages 3 0 R >>");
  // 2: Outlines
  addObject("<< /Type /Outlines /Count 0 >>");
  // 3: Pages
  addObject("<< /Type /Pages /Kids [4 0 R] /Count 1 >>");
  // 4: Page
  addObject(
    "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 595 842] /Contents 7 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
  );
  // 5: Font F1 (Helvetica)
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  // 6: Font F2 (Helvetica-Bold)
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  // 7: Content Stream
  addObject(`<< /Length ${streamLength} >>\nstream\n${streamData}\nendstream`);

  // Assemble PDF file binary
  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const startxref = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (let i = 1; i <= objects.length; i++) {
    body += `${offsets[i].toString().padStart(10, "0")} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(body, "utf8");
}

/**
 * Stores the generated invoice PDF into private bucket and returns signed presigned download URL.
 */
export async function storeInvoicePdf(params: {
  organizationId: string;
  invoiceNumber: string;
  pdfBuffer: Buffer;
}): Promise<{ pdfPath: string; signedUrl: string }> {
  const sanitizedInv = params.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const key = `invoices/${params.organizationId}/${sanitizedInv}.pdf`;

  if (isStorageConfigured()) {
    try {
      const config = getStorageConfig();
      const s3Client = (await import("@/app/lib/storage")).getStorageConfig();
      // Import client dynamically
      const { S3Client } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ContentType: "application/pdf",
          Body: params.pdfBuffer,
        }),
      );

      const signedUrl = await createPresignedDownload({
        key,
        filename: `${sanitizedInv}.pdf`,
        expiresIn: 86400 * 7, // 7 days signed URL
      });

      return { pdfPath: key, signedUrl };
    } catch (err) {
      console.warn("Storage upload failed, falling back to local media bucket:", err);
    }
  }

  // Fallback to local media bucket store
  const mediaBucket = getMediaStorageBucket();
  const stored = await mediaBucket.store(key, params.pdfBuffer, "application/pdf");

  return {
    pdfPath: key,
    signedUrl: stored.url,
  };
}
