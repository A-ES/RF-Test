import { prisma } from "@/app/lib/db";
import {
  type OrderStatus,
  nextNumber,
  formatSequenceNumber,
} from "@rf-intelligence/db";
import { getInventoryProvider } from "@/app/lib/inventory/provider";
import { priceOrder } from "./pricing";
import { loadPricingData } from "./pricing-data";
import { notifyClientDraftReady } from "./draft-notification";
import {
  extractOrderData,
  type ExtractedOrderData,
} from "./understand";
import {
  matchOrderLines,
  type MatchedOrderLine,
} from "./match";
import { recordOrderStateChange } from "./order-service";
import { publishToChannel } from "@/app/lib/realtime/server";
import { orgChannel, REALTIME_EVENTS } from "@/app/lib/realtime/channels";
import { resolveOutboundAddressing } from "@/app/lib/messaging/outbound";
import { messagingProviderFor } from "@/app/lib/messaging/providers";

export const BLOCKING_FLAGS = [
  "INSUFFICIENT_STOCK",
  "OUT_OF_STOCK",
  "UNCLEAR_PRODUCT",
  "NO_PRICE",
  "MISSING_DELIVERY_DATE",
  "MISSING_ADDRESS",
  "NEW_CUSTOMER",
  "EXTRACTION_FAILED",
  "MISSING_QUANTITY",
] as const;

export type BlockingFlag = (typeof BLOCKING_FLAGS)[number];

export interface CreateDraftOrderInput {
  organizationId: string;
  customerId: string;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  intent?: "ORDER_REQUEST" | "ORDER_CHANGE";
  extracted: ExtractedOrderData;
  matchedLines: MatchedOrderLine[];
  isNewCustomer?: boolean;
  skipCustomerAck?: boolean;
}

export interface DraftOrderResult {
  order: {
    id: string;
    draftNumber: string;
    orderNumber: string | null;
    status: OrderStatus;
    totalMinor: number;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    version: number;
    flags: string[];
    lines: Array<{
      id?: string;
      sku: string;
      rawText: string;
      qty: number;
      unitPriceMinor: number;
      lineTotalMinor: number;
      flags: string[];
    }>;
  };
  isDuplicate?: boolean;
  actionTaken: "CREATED" | "UPDATED_DRAFT" | "CHANGE_REQUEST_ON_APPROVED" | "DUPLICATE";
}

/**
 * 6. Draft Creation (idempotent on sourceMessageId):
 * - Load stock through InventoryProvider
 * - Flag INSUFFICIENT_STOCK (with available qty), OUT_OF_STOCK, UNCLEAR_PRODUCT, NO_PRICE,
 *   MISSING_DELIVERY_DATE, MISSING_ADDRESS, NEW_CUSTOMER; never silently change quantities or substitute products.
 * - Price with priceOrder.
 * - Create the Order as DRAFT (NEEDS_REVIEW if any blocking flag), with no orderNumber, no reservation and no StockMovement.
 * - ORDER_CHANGE edits an open draft, re-prices and bumps version; a change to an APPROVED order becomes a change-request flag for the client.
 *
 * 7. Link the order to the conversation, set it WAITING_FOR_CLIENT, publish Ably order.created,
 * and send the customer only a configurable, skippable acknowledgement that the request is awaiting confirmation (never a confirmation).
 */
export async function createOrUpdateDraftOrder(
  input: CreateDraftOrderInput,
): Promise<DraftOrderResult> {
  const {
    organizationId,
    customerId,
    conversationId,
    sourceMessageId,
    intent = "ORDER_REQUEST",
    extracted,
    matchedLines,
    isNewCustomer,
    skipCustomerAck = false,
  } = input;

  // 1. Idempotency on sourceMessageId
  if (sourceMessageId && intent === "ORDER_REQUEST") {
    const existing = await prisma.order.findFirst({
      where: { organizationId, sourceMessageId },
      include: { lines: true },
    });

    if (existing) {
      let existingFlags: string[] = [];
      try {
        existingFlags = JSON.parse(existing.flagsJson) as string[];
      } catch {}

      return {
        order: {
          id: existing.id,
          draftNumber: existing.draftNumber,
          orderNumber: existing.orderNumber,
          status: existing.status,
          totalMinor: existing.totalMinor,
          subtotalMinor: existing.subtotalMinor,
          discountMinor: existing.discountMinor,
          taxMinor: existing.taxMinor,
          version: existing.version,
          flags: existingFlags,
          lines: existing.lines.map((l) => ({
            id: l.id,
            sku: l.sku,
            rawText: l.rawText,
            qty: l.qty,
            unitPriceMinor: l.unitPriceMinor,
            lineTotalMinor: l.lineTotalMinor,
            flags: parseJsonFlags(l.flagsJson),
          })),
        },
        isDuplicate: true,
        actionTaken: "DUPLICATE",
      };
    }
  }

  // 2. Fetch Customer and evaluate NEW_CUSTOMER & MISSING_ADDRESS
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
  });

  const orderFlags: string[] = [];
  if (isNewCustomer || customer?.status === "LEAD") {
    orderFlags.push("NEW_CUSTOMER");
  }

  const deliveryAddress =
    extracted.deliveryAddress?.trim() || customer?.company?.trim() || null;
  if (!extracted.deliveryAddress?.trim()) {
    orderFlags.push("MISSING_ADDRESS");
  }

  if (!extracted.resolvedDeliveryDate && !extracted.deliveryDate) {
    orderFlags.push("MISSING_DELIVERY_DATE");
  }

  if (extracted.flags?.includes("EXTRACTION_FAILED")) {
    orderFlags.push("EXTRACTION_FAILED");
  }

  // 3. Stock Check through InventoryProvider (NEVER reserve, NEVER deduct, NEVER substitute)
  const inventoryProvider = getInventoryProvider();
  const lineDetails: Array<{
    line: MatchedOrderLine;
    lineFlags: string[];
    availableQty?: number;
  }> = [];

  for (const mLine of matchedLines) {
    const lineFlags = [...mLine.flags];

    if (!mLine.quantity || mLine.quantity <= 0) {
      lineFlags.push("MISSING_QUANTITY");
      if (!orderFlags.includes("MISSING_QUANTITY")) {
        orderFlags.push("MISSING_QUANTITY");
      }
    }

    if (mLine.productId) {
      try {
        const stock = await inventoryProvider.getStock(
          organizationId,
          mLine.productId,
          prisma,
        );
        const reqQty = mLine.quantity ?? 1;

        if (stock.available <= 0) {
          lineFlags.push("OUT_OF_STOCK");
          if (!orderFlags.includes("OUT_OF_STOCK")) {
            orderFlags.push("OUT_OF_STOCK");
          }
        } else if (stock.available < reqQty) {
          lineFlags.push(`INSUFFICIENT_STOCK:${stock.available}`);
          if (!orderFlags.includes("INSUFFICIENT_STOCK")) {
            orderFlags.push("INSUFFICIENT_STOCK");
          }
        }

        lineDetails.push({
          line: mLine,
          lineFlags,
          availableQty: stock.available,
        });
      } catch {
        lineDetails.push({ line: mLine, lineFlags });
      }
    } else {
      if (!lineFlags.includes("UNCLEAR_PRODUCT")) {
        lineFlags.push("UNCLEAR_PRODUCT");
      }
      if (!orderFlags.includes("UNCLEAR_PRODUCT")) {
        orderFlags.push("UNCLEAR_PRODUCT");
      }
      lineDetails.push({ line: mLine, lineFlags });
    }
  }

  // 4. Pricing with priceOrder
  const validProductIds = matchedLines
    .map((l) => l.productId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const pricingData = await loadPricingData({
    organizationId,
    customerId,
    productIds: validProductIds,
  });

  const products =
    validProductIds.length > 0
      ? await prisma.product.findMany({
          where: { organizationId, id: { in: validProductIds } },
        })
      : [];
  const productMap = new Map(products.map((p) => [p.id, p]));

  const pricingLines = lineDetails.map(({ line }) => {
    const prod = line.productId ? productMap.get(line.productId) : null;
    return {
      productId: line.productId || "unknown",
      sku: line.sku,
      qty: Math.max(1, line.quantity ?? 1),
      basePriceMinor: prod?.basePriceMinor ?? 0,
      taxRateBps: prod?.taxRateBps ?? 1800,
    };
  });

  const pricing = priceOrder({
    lines: pricingLines,
    customer: customer
      ? {
          id: customer.id,
          customerPrices: pricingData.customerPrices.map((cp) => ({
            productId: cp.productId,
            priceMinor: cp.priceMinor,
            validFrom: cp.validFrom,
            validTo: cp.validTo,
          })),
        }
      : null,
    rules: pricingData.discountRules.map((dr) => ({
      id: dr.id,
      scope: dr.scope,
      customerId: dr.customerId,
      productId: dr.productId,
      type: dr.type,
      value: dr.value,
      minQty: dr.minQty,
      minOrderMinor: dr.minOrderMinor,
      validFrom: dr.validFrom,
      validTo: dr.validTo,
      priority: dr.priority,
    })),
    taxConfig: { defaultTaxRateBps: 1800 },
    now: new Date(),
  });

  // Merge pricing flags
  for (let i = 0; i < lineDetails.length; i++) {
    const pricedLine = pricing.lines[i];
    if (pricedLine) {
      for (const f of pricedLine.flags) {
        if (!lineDetails[i].lineFlags.includes(f)) {
          lineDetails[i].lineFlags.push(f);
        }
      }
    }
  }

  for (const f of pricing.flags) {
    if (!orderFlags.includes(f)) {
      orderFlags.push(f);
    }
  }

  // Deduplicate order flags
  const uniqueOrderFlags = Array.from(new Set(orderFlags));

  // Determine Order Status: NEEDS_REVIEW if any blocking flag, else DRAFT
  const hasBlockingFlag = uniqueOrderFlags.some((flag) =>
    BLOCKING_FLAGS.some((b) => flag.startsWith(b)),
  );
  const status: OrderStatus = hasBlockingFlag ? "NEEDS_REVIEW" : "DRAFT";

  // 5. Check ORDER_CHANGE handling
  if (intent === "ORDER_CHANGE") {
    // Look for an open draft to edit
    const openDraft = await prisma.order.findFirst({
      where: {
        organizationId,
        customerId,
        status: { in: ["DRAFT", "NEEDS_REVIEW"] },
      },
      orderBy: { updatedAt: "desc" },
      include: { lines: true },
    });

    if (openDraft) {
      // Edit open draft, re-price and bump version
      const bumpedVersion = openDraft.version + 1;

      const updated = await prisma.$transaction(async (tx) => {
        // Delete old lines
        await tx.orderLine.deleteMany({
          where: { orderId: openDraft.id },
        });

        // Create updated lines
        const newLines = await Promise.all(
          lineDetails.map(({ line, lineFlags }, idx) => {
            const pLine = pricing.lines[idx];
            return tx.orderLine.create({
              data: {
                organizationId,
                orderId: openDraft.id,
                productId: line.productId,
                sku: line.sku,
                rawText: line.rawText,
                matchConfidence: line.matchConfidence,
                qty: line.quantity ?? 1,
                unitPriceMinor: pLine?.unitPriceMinor ?? 0,
                discountMinor: pLine?.discountMinor ?? 0,
                taxMinor: pLine?.taxMinor ?? 0,
                lineTotalMinor: pLine?.totalMinor ?? 0,
                flagsJson: JSON.stringify(lineFlags),
              },
            });
          }),
        );

        const savedOrder = await tx.order.update({
          where: { id: openDraft.id },
          data: {
            status,
            subtotalMinor: pricing.subtotalMinor,
            discountMinor: pricing.discountMinor,
            taxMinor: pricing.taxMinor,
            totalMinor: pricing.totalMinor,
            deliveryDate: extracted.resolvedDeliveryDate,
            deliveryAddress: deliveryAddress,
            instructions: extracted.instructions,
            flagsJson: JSON.stringify(uniqueOrderFlags),
            version: bumpedVersion,
          },
        });

        return { order: savedOrder, lines: newLines };
      });

      await recordOrderStateChange({
        orderId: openDraft.id,
        orderNumber: null,
        draftNumber: openDraft.draftNumber,
        organizationId,
        actor: { type: "CUSTOMER", name: "WhatsApp Customer" },
        eventType: "ORDER_UPDATED",
        fromStatus: openDraft.status,
        toStatus: status,
        payload: {
          action: "ORDER_CHANGE",
          bumpedVersion,
          flags: uniqueOrderFlags,
        },
      });

      await postDraftSideEffects({
        order: updated.order,
        orderFlags: uniqueOrderFlags,
        conversationId,
        organizationId,
        skipCustomerAck,
      });

      return {
        order: {
          id: updated.order.id,
          draftNumber: updated.order.draftNumber,
          orderNumber: null,
          status: updated.order.status,
          totalMinor: updated.order.totalMinor,
          subtotalMinor: updated.order.subtotalMinor,
          discountMinor: updated.order.discountMinor,
          taxMinor: updated.order.taxMinor,
          version: updated.order.version,
          flags: uniqueOrderFlags,
          lines: updated.lines.map((l) => ({
            id: l.id,
            sku: l.sku,
            rawText: l.rawText,
            qty: l.qty,
            unitPriceMinor: l.unitPriceMinor,
            lineTotalMinor: l.lineTotalMinor,
            flags: parseJsonFlags(l.flagsJson),
          })),
        },
        actionTaken: "UPDATED_DRAFT",
      };
    }

    // Check for an APPROVED order: "a change to an APPROVED order becomes a change-request flag for the client"
    const approvedOrder = await prisma.order.findFirst({
      where: {
        organizationId,
        customerId,
        status: { in: ["APPROVED", "FULFILLING", "DISPATCHED"] },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (approvedOrder) {
      let currentFlags: string[] = [];
      try {
        currentFlags = JSON.parse(approvedOrder.flagsJson);
      } catch {}

      if (!currentFlags.includes("CHANGE_REQUESTED")) {
        currentFlags.push("CHANGE_REQUESTED");
      }

      await prisma.order.update({
        where: { id: approvedOrder.id },
        data: { flagsJson: JSON.stringify(currentFlags) },
      });

      await recordOrderStateChange({
        orderId: approvedOrder.id,
        orderNumber: approvedOrder.orderNumber,
        draftNumber: approvedOrder.draftNumber,
        organizationId,
        actor: { type: "CUSTOMER", name: "WhatsApp Customer" },
        eventType: "CHANGE_REQUESTED",
        fromStatus: approvedOrder.status,
        toStatus: approvedOrder.status,
        payload: {
          sourceMessageId,
          extracted,
        },
      });

      if (conversationId) {
        await prisma.customerConversation.update({
          where: { id: conversationId },
          data: { status: "WAITING_FOR_CLIENT" },
        });
      }

      return {
        order: {
          id: approvedOrder.id,
          draftNumber: approvedOrder.draftNumber,
          orderNumber: approvedOrder.orderNumber,
          status: approvedOrder.status,
          totalMinor: approvedOrder.totalMinor,
          subtotalMinor: approvedOrder.subtotalMinor,
          discountMinor: approvedOrder.discountMinor,
          taxMinor: approvedOrder.taxMinor,
          version: approvedOrder.version,
          flags: currentFlags,
          lines: [],
        },
        actionTaken: "CHANGE_REQUEST_ON_APPROVED",
      };
    }
  }

  // 6. Create New DRAFT order
  const draftSeq = await nextNumber(organizationId, "DRAFT", prisma);
  const draftNumber = formatSequenceNumber(draftSeq, "DFT-", 4);

  const createdOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        organizationId,
        customerId,
        conversationId: conversationId ?? null,
        sourceMessageId: sourceMessageId ?? null,
        draftNumber,
        orderNumber: null, // GUARD: strictly null for drafts
        status, // DRAFT or NEEDS_REVIEW
        paymentStatus: "UNPAID",
        currency: "INR",
        subtotalMinor: pricing.subtotalMinor,
        discountMinor: pricing.discountMinor,
        taxMinor: pricing.taxMinor,
        totalMinor: pricing.totalMinor,
        deliveryDate: extracted.resolvedDeliveryDate,
        deliveryAddress,
        instructions: extracted.instructions,
        flagsJson: JSON.stringify(uniqueOrderFlags),
        version: 1,
        lines: {
          create: lineDetails.map(({ line, lineFlags }, idx) => {
            const pLine = pricing.lines[idx];
            return {
              organizationId,
              productId: line.productId,
              sku: line.sku,
              rawText: line.rawText,
              matchConfidence: line.matchConfidence,
              qty: line.quantity ?? 1,
              unitPriceMinor: pLine?.unitPriceMinor ?? 0,
              discountMinor: pLine?.discountMinor ?? 0,
              taxMinor: pLine?.taxMinor ?? 0,
              lineTotalMinor: pLine?.totalMinor ?? 0,
              flagsJson: JSON.stringify(lineFlags),
            };
          }),
        },
      },
      include: { lines: true },
    });

    return order;
  });

  // 7. Audit log & events
  await recordOrderStateChange({
    orderId: createdOrder.id,
    orderNumber: null,
    draftNumber: createdOrder.draftNumber,
    organizationId,
    actor: { type: "CUSTOMER", name: "WhatsApp Customer" },
    eventType: "CREATED",
    fromStatus: null,
    toStatus: status,
    payload: {
      lineCount: createdOrder.lines.length,
      flags: uniqueOrderFlags,
      totalMinor: createdOrder.totalMinor,
    },
  });

  // 8. Link to conversation, publish Ably, send provisional acknowledgment
  await postDraftSideEffects({
    order: createdOrder,
    orderFlags: uniqueOrderFlags,
    conversationId,
    organizationId,
    skipCustomerAck,
  });

  return {
    order: {
      id: createdOrder.id,
      draftNumber: createdOrder.draftNumber,
      orderNumber: null,
      status: createdOrder.status,
      totalMinor: createdOrder.totalMinor,
      subtotalMinor: createdOrder.subtotalMinor,
      discountMinor: createdOrder.discountMinor,
      taxMinor: createdOrder.taxMinor,
      version: createdOrder.version,
      flags: uniqueOrderFlags,
      lines: createdOrder.lines.map((l) => ({
        id: l.id,
        sku: l.sku,
        rawText: l.rawText,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor,
        lineTotalMinor: l.lineTotalMinor,
        flags: parseJsonFlags(l.flagsJson),
      })),
    },
    actionTaken: "CREATED",
  };
}

/**
 * Executes draft side-effects:
 * - Link conversation & set status WAITING_FOR_CLIENT
 * - Publish Ably order.created
 * - Send provisional acknowledgment (never a confirmation)
 */
async function postDraftSideEffects(params: {
  order: { id: string; draftNumber: string; status: OrderStatus };
  orderFlags: string[];
  conversationId?: string | null;
  organizationId: string;
  skipCustomerAck: boolean;
}): Promise<void> {
  const { order, orderFlags, conversationId, organizationId, skipCustomerAck } =
    params;

  // Link conversation and set WAITING_FOR_CLIENT
  if (conversationId) {
    try {
      await prisma.customerConversation.update({
        where: { id: conversationId },
        data: { status: "WAITING_FOR_CLIENT" },
      });
    } catch {}
  }

  // Publish Ably order.created
  try {
    await publishToChannel(
      orgChannel(organizationId, "orders"),
      "order.created",
      {
        orderId: order.id,
        draftNumber: order.draftNumber,
        status: order.status,
        flags: orderFlags,
        timestamp: new Date().toISOString(),
      },
    );
    await publishToChannel(
      orgChannel(organizationId, "orders"),
      REALTIME_EVENTS.orderCreated,
      {
        orderId: order.id,
        draftNumber: order.draftNumber,
        status: order.status,
        flags: orderFlags,
        timestamp: new Date().toISOString(),
      },
    );
  } catch {}

  // Deliver deduplicated client notifications linking to /orders/:id
  try {
    await notifyClientDraftReady({
      organizationId,
      orderId: order.id,
      draftNumber: order.draftNumber,
    });
  } catch {}

  // Send provisional customer acknowledgment (never an order confirmation)
  if (!skipCustomerAck && conversationId) {
    try {
      const addressing = await resolveOutboundAddressing(
        organizationId,
        conversationId,
      );

      const ackText =
        `We have received your order request (Draft ${order.draftNumber}). ` +
        `Our team is reviewing the details and awaiting confirmation. ` +
        `Please note: this is an acknowledgment awaiting confirmation, not a final order confirmation. ` +
        `You will receive an update once confirmed.`;

      await messagingProviderFor(addressing.channel).sendOutbound({
        inboxIdentifier: addressing.inboxIdentifier,
        contactIdentifier: addressing.contactIdentifier,
        body: ackText,
      });
    } catch {}
  }
}

/**
 * End-to-end draft order processing orchestrator:
 * Message -> understand -> match -> draft
 */
export async function processDraftOrder(params: {
  organizationId: string;
  customerId: string;
  conversationId: string;
  messageId: string;
  intent?: "ORDER_REQUEST" | "ORDER_CHANGE";
  isNewCustomer?: boolean;
}): Promise<DraftOrderResult> {
  const { organizationId, customerId, conversationId, messageId, intent = "ORDER_REQUEST", isNewCustomer } = params;

  const message = await prisma.customerMessage.findFirst({
    where: { id: messageId, organizationId },
  });

  const textToUnderstand = message?.transcript || message?.body || "";

  // 1. Understand & extract
  const extracted = await extractOrderData(textToUnderstand, {
    organizationId,
  });

  // 2. Match products
  const matchedLines = await matchOrderLines(
    extracted.lines,
    organizationId,
    prisma,
  );

  // 3. Create or update draft
  return createOrUpdateDraftOrder({
    organizationId,
    customerId,
    conversationId,
    sourceMessageId: messageId,
    intent,
    extracted,
    matchedLines,
    isNewCustomer,
  });
}

function parseJsonFlags(jsonStr: string | null | undefined): string[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
