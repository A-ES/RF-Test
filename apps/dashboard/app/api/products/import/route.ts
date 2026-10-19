import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { canWriteCatalog } from "@/app/lib/catalog/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export interface CsvRowError {
  row: number;
  sku?: string;
  field: string;
  message: string;
  raw?: Record<string, string>;
}

export interface ParsedProductRow {
  row: number;
  sku: string;
  name: string;
  description?: string | null;
  unit: string;
  basePriceMinor: number;
  taxRateBps: number;
  stock: number;
  reorderLevel: number;
  aliases: string[];
  action?: "CREATE" | "UPDATE";
}

/**
 * Robust CSV Parser supporting quoted fields, multiline cells, escaped quotes, and commas.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const nc = text[i + 1];

    if (inQuotes) {
      if (c === '"') {
        if (nc === '"') {
          field += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field.trim());
        field = "";
      } else if (c === "\r" || c === "\n") {
        if (c === "\r" && nc === "\n") {
          i++;
        }
        row.push(field.trim());
        field = "";
        if (row.some((cell) => cell.length > 0)) {
          records.push(row);
        }
        row = [];
      } else {
        field += c;
      }
    }
  }

  // Push remaining field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) {
      records.push(row);
    }
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const rawHeaders = records[0];
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));

  const rows: Record<string, string>[] = [];
  for (let idx = 1; idx < records.length; idx++) {
    const vals = records[idx];
    const rowObj: Record<string, string> = {};
    for (let hIdx = 0; hIdx < headers.length; hIdx++) {
      rowObj[headers[hIdx]] = vals[hIdx] !== undefined ? vals[hIdx] : "";
    }
    rows.push(rowObj);
  }

  return { headers, rows };
}

/**
 * Validates and normalizes parsed CSV rows against product rules.
 */
export async function validateAndNormalizeCsvRows(
  rows: Record<string, string>[],
  orgId: string,
): Promise<{
  validRows: ParsedProductRow[];
  errors: CsvRowError[];
}> {
  const validRows: ParsedProductRow[] = [];
  const errors: CsvRowError[] = [];
  const seenSkusInFile = new Map<string, number>();

  // Fetch existing SKUs in the organization to determine CREATE vs UPDATE
  const existingProducts = await prisma.product.findMany({
    where: { organizationId: orgId },
    select: { sku: true },
  });
  const existingSkuSet = new Set(existingProducts.map((p) => p.sku.toUpperCase()));

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2; // 1-based, skipping header row

    // Extract field variants
    const skuRaw = raw["sku"] || raw["productsku"] || raw["itemcode"] || "";
    const nameRaw = raw["name"] || raw["productname"] || raw["title"] || "";
    const descRaw = raw["description"] || raw["desc"] || "";
    const unitRaw = raw["unit"] || raw["uom"] || "PCS";
    const priceRaw = raw["basepriceminor"] || raw["price"] || raw["unitprice"] || raw["baseprice"] || "";
    const taxRaw = raw["taxratebps"] || raw["taxrate"] || raw["tax"] || "1800";
    const stockRaw = raw["stock"] || raw["onhand"] || raw["qty"] || raw["quantity"] || "0";
    const reorderRaw = raw["reorderlevel"] || raw["reorder"] || raw["reorderpoint"] || "10";
    const aliasesRaw = raw["aliases"] || raw["alias"] || "";

    const sku = skuRaw.trim().toUpperCase();
    const name = nameRaw.trim();

    // 1. SKU validation
    if (!sku) {
      errors.push({
        row: rowNum,
        field: "sku",
        message: "SKU is required",
        raw,
      });
      continue;
    }

    if (seenSkusInFile.has(sku)) {
      errors.push({
        row: rowNum,
        sku,
        field: "sku",
        message: `Duplicate SKU "${sku}" found in CSV (first seen at row ${seenSkusInFile.get(sku)})`,
        raw,
      });
      continue;
    }
    seenSkusInFile.set(sku, rowNum);

    // 2. Name validation
    if (!name) {
      errors.push({
        row: rowNum,
        sku,
        field: "name",
        message: "Product name is required",
        raw,
      });
      continue;
    }

    // 3. Price validation (supports paise or rupees)
    let basePriceMinor = 0;
    if (!priceRaw) {
      errors.push({
        row: rowNum,
        sku,
        field: "price",
        message: "Price is required",
        raw,
      });
      continue;
    }

    const priceTrimmed = priceRaw.trim();
    if (priceTrimmed.startsWith("-") || Number(priceTrimmed) < 0) {
      errors.push({
        row: rowNum,
        sku,
        field: "price",
        message: `Invalid price "${priceRaw}" (must be a non-negative number)`,
        raw,
      });
      continue;
    }

    const cleanedPrice = priceTrimmed.replace(/[^0-9.]/g, "");
    const numPrice = Number(cleanedPrice);
    if (isNaN(numPrice) || numPrice < 0) {
      errors.push({
        row: rowNum,
        sku,
        field: "price",
        message: `Invalid price "${priceRaw}" (must be a non-negative number)`,
        raw,
      });
      continue;
    }

    if (raw["basepriceminor"]) {
      basePriceMinor = Math.round(numPrice);
    } else if (cleanedPrice.includes(".") || numPrice < 10000) {
      basePriceMinor = Math.round(numPrice * 100);
    } else {
      basePriceMinor = Math.round(numPrice);
    }

    // 4. Tax Rate BPS validation (default 1800)
    let taxRateBps = 1800;
    if (taxRaw) {
      const cleanTax = taxRaw.replace(/[^0-9.]/g, "");
      const numTax = Number(cleanTax);
      if (isNaN(numTax) || numTax < 0) {
        errors.push({
          row: rowNum,
          sku,
          field: "taxRate",
          message: `Invalid tax rate "${taxRaw}"`,
          raw,
        });
        continue;
      }
      taxRateBps = numTax <= 100 ? Math.round(numTax * 100) : Math.round(numTax);
    }

    // 5. Stock validation (must be non-negative integer)
    let stock = 0;
    if (stockRaw) {
      const stockTrimmed = stockRaw.trim();
      if (stockTrimmed.startsWith("-") || Number(stockTrimmed) < 0) {
        errors.push({
          row: rowNum,
          sku,
          field: "stock",
          message: `Invalid stock quantity "${stockRaw}" (must be a non-negative integer)`,
          raw,
        });
        continue;
      }

      const numStock = Number(stockTrimmed.replace(/[^0-9]/g, ""));
      if (isNaN(numStock) || numStock < 0 || !Number.isInteger(numStock)) {
        errors.push({
          row: rowNum,
          sku,
          field: "stock",
          message: `Invalid stock quantity "${stockRaw}" (must be a non-negative integer)`,
          raw,
        });
        continue;
      }
      stock = numStock;
    }

    // 6. Reorder level validation
    let reorderLevel = 10;
    if (reorderRaw) {
      const numReorder = Number(reorderRaw.replace(/[^0-9]/g, ""));
      if (isNaN(numReorder) || numReorder < 0) {
        errors.push({
          row: rowNum,
          sku,
          field: "reorderLevel",
          message: `Invalid reorder level "${reorderRaw}"`,
          raw,
        });
        continue;
      }
      reorderLevel = Math.round(numReorder);
    }

    // 7. Aliases parsing
    const aliases = aliasesRaw
      ? aliasesRaw
          .split(/[;,|]/)
          .map((a) => a.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const action = existingSkuSet.has(sku) ? "UPDATE" : "CREATE";

    validRows.push({
      row: rowNum,
      sku,
      name,
      description: descRaw.trim() || null,
      unit: unitRaw.trim() || "PCS",
      basePriceMinor,
      taxRateBps,
      stock,
      reorderLevel,
      aliases,
      action,
    });
  }

  return { validRows, errors };
}

/**
 * POST /api/products/import — CSV product & stock import with dry-run preview and upsert.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (!canWriteCatalog(session.role)) {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  const orgId = session.organizationId;

  let csvContent = "";
  let dryRun = false;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const dryRunField = formData.get("dryRun");
    dryRun = dryRunField === "true" || dryRunField === "1";

    if (file && typeof file === "object" && "text" in file) {
      csvContent = await (file as Blob).text();
    } else {
      return json({ error: "No CSV file provided in upload" }, 400);
    }
  } else {
    try {
      const body = await request.json();
      csvContent = typeof body.csvContent === "string" ? body.csvContent : "";
      dryRun = Boolean(body.dryRun);
    } catch {
      return json({ error: "Invalid JSON or form body" }, 400);
    }
  }

  if (!csvContent.trim()) {
    return json({ error: "CSV content is empty" }, 400);
  }

  const { rows } = parseCsv(csvContent);
  if (rows.length === 0) {
    return json({ error: "No data rows found in CSV" }, 400);
  }

  const { validRows, errors } = await validateAndNormalizeCsvRows(rows, orgId);

  // If dry-run requested, return full preview without modifying database
  if (dryRun) {
    return json({
      dryRun: true,
      totalRows: rows.length,
      validCount: validRows.length,
      errorCount: errors.length,
      errors,
      preview: validRows,
    });
  }

  // Live import: if there are validation errors, reject to prevent partial corruption
  if (errors.length > 0) {
    return json(
      {
        error: "CSV validation failed with row-level errors",
        totalRows: rows.length,
        validCount: validRows.length,
        errorCount: errors.length,
        errors,
      },
      422,
    );
  }

  // Execute live upsert transaction
  let createdCount = 0;
  let updatedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of validRows) {
      // Find existing product by SKU in this organization
      const existing = await tx.product.findUnique({
        where: {
          organizationId_sku: {
            organizationId: orgId,
            sku: item.sku,
          },
        },
        include: {
          inventoryLevel: true,
        },
      });

      let productId: string;

      if (existing) {
        // Update product
        productId = existing.id;
        await tx.product.update({
          where: { id: existing.id },
          data: {
            name: item.name,
            description: item.description,
            unit: item.unit,
            basePriceMinor: item.basePriceMinor,
            taxRateBps: item.taxRateBps,
            reorderLevel: item.reorderLevel,
            isActive: true,
          },
        });

        // Adjust inventory if stock was provided
        const currentOnHand = existing.inventoryLevel?.onHand ?? 0;
        const delta = item.stock - currentOnHand;

        await tx.inventoryLevel.upsert({
          where: { organizationId_productId: { organizationId: orgId, productId } },
          update: { onHand: item.stock },
          create: {
            organizationId: orgId,
            productId,
            onHand: item.stock,
            reserved: 0,
          },
        });

        if (delta !== 0) {
          await tx.stockMovement.create({
            data: {
              organizationId: orgId,
              productId,
              delta,
              reason: "ADJUSTMENT",
              actorId: session.userId,
            },
          });
        }

        updatedCount++;
      } else {
        // Create product
        const created = await tx.product.create({
          data: {
            organizationId: orgId,
            sku: item.sku,
            name: item.name,
            description: item.description,
            unit: item.unit,
            basePriceMinor: item.basePriceMinor,
            taxRateBps: item.taxRateBps,
            reorderLevel: item.reorderLevel,
            isActive: true,
          },
        });
        productId = created.id;

        // Create inventory level
        await tx.inventoryLevel.create({
          data: {
            organizationId: orgId,
            productId,
            onHand: item.stock,
            reserved: 0,
          },
        });

        if (item.stock > 0) {
          await tx.stockMovement.create({
            data: {
              organizationId: orgId,
              productId,
              delta: item.stock,
              reason: "ADJUSTMENT",
              actorId: session.userId,
            },
          });
        }

        createdCount++;
      }

      // Add aliases if not already in organization
      if (item.aliases.length > 0) {
        for (const alias of item.aliases) {
          const existsAlias = await tx.productAlias.findUnique({
            where: {
              organizationId_alias: {
                organizationId: orgId,
                alias,
              },
            },
          });
          if (!existsAlias) {
            await tx.productAlias.create({
              data: {
                organizationId: orgId,
                productId,
                alias,
              },
            });
          }
        }
      }
    }
  });

  return json({
    dryRun: false,
    success: true,
    created: createdCount,
    updated: updatedCount,
    total: createdCount + updatedCount,
  });
}
