import { z } from "zod";
import { completeDeepSeekJson } from "@/app/lib/deepseek";

export const AI_INTENT_CATEGORIES = [
  "GENERAL_ENQUIRY",
  "PRODUCT_ENQUIRY",
  "NEW_ORDER",
  "ORDER_MODIFICATION",
  "ORDER_CANCELLATION",
  "COMPLAINT",
  "DELIVERY_ENQUIRY",
  "PAYMENT_ENQUIRY",
  "RETURN_OR_REFUND",
  "FOLLOW_UP",
  "OTHER",
] as const;

export type AiIntentCategory = (typeof AI_INTENT_CATEGORIES)[number];

export const RequestedQuantitySchema = z.object({
  product: z.string(),
  quantity: z.number(),
  unit: z.string().optional(),
});

export type RequestedQuantity = z.infer<typeof RequestedQuantitySchema>;

export const AiUnderstandingSchema = z.object({
  intent: z.enum(AI_INTENT_CATEGORIES),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  customerSentiment: z.enum(["POSITIVE", "NEUTRAL", "FRUSTRATED", "URGENT"]),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  mentionedProducts: z.array(z.string()).default([]),
  requestedQuantities: z.array(RequestedQuantitySchema).default([]),
  requestedDeliveryDate: z.string().nullable().optional(),
  relatedOrderReference: z.string().nullable().optional(),
  missingInformation: z.array(z.string()).default([]),
  recommendedAction: z.string(),
  requiresHumanReview: z.boolean().default(true),
});

export type AiUnderstanding = z.infer<typeof AiUnderstandingSchema>;

const SYSTEM_PROMPT = `
You are the AI Intelligence Engine for RF Intelligence, an enterprise SaaS platform for orders, fulfillment, and customer communication.
Analyze the incoming customer message and classify it into EXACTLY ONE of the following 11 categories:
1. GENERAL_ENQUIRY: general business question, greetings, address/hours inquiries.
2. PRODUCT_ENQUIRY: asking about product availability, catalog specifications, pricing inquiries without placing an order.
3. NEW_ORDER: customer requesting to purchase/order items, specifying quantities or asking for quote to order.
4. ORDER_MODIFICATION: change to an existing order (add/remove items, change quantities, change delivery address).
5. ORDER_CANCELLATION: requesting to cancel an existing order.
6. COMPLAINT: damaged goods, bad experience, late delivery dispute, poor service.
7. DELIVERY_ENQUIRY: tracking shipment, dispatch status, when will order arrive.
8. PAYMENT_ENQUIRY: invoice questions, payment links, payment confirmation, bank details.
9. RETURN_OR_REFUND: requesting a return, replacement, or refund for delivered products.
10. FOLLOW_UP: checking in on previous conversation, "any update?", reminder.
11. OTHER: spam, meaningless text, or unclassifiable.

STRICT RULES:
- Never invent product names, prices, quantities, or customer details.
- If information is not mentioned, return empty array [] or null.
- Extract any order references (e.g. #ORD-1234, ORD_102, #4492).
- Return valid JSON matching the specified schema.
`;

/**
 * Robust heuristic classifier for fallback when DeepSeek is unreachable or unconfigured.
 */
export function classifyMessageHeuristic(text: string): AiUnderstanding {
  const lower = text.toLowerCase().trim();

  // Order references
  const orderRefMatch = text.match(/#?(?:ORD[-_]?\d+|DRAFT[-_]?\d+|\b(?:order|invoice)\s*(?:#|no\.?|number)?\s*(\d+))/i);
  const relatedOrderReference = orderRefMatch ? orderRefMatch[0].trim() : null;

  // Extract quantities and products (e.g., "20 boxes of Widget A", "10 units item X")
  const requestedQuantities: RequestedQuantity[] = [];
  const mentionedProducts: string[] = [];
  const qtyRegex = /(\d+)\s*(boxes|box|cartons|carton|bags|bag|cases|case|packs|pack|pcs|pieces|kg|units|unit|nos)?\s*(?:of\s+)?([A-Za-z0-9\s\-]{2,30}?)(?=[,.]|\band\b|\bcan\b|\bplease\b|\bfor\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = qtyRegex.exec(text)) !== null) {
    const qty = parseInt(match[1], 10);
    const unit = match[2]?.trim() || "PCS";
    const prod = match[3]?.trim();
    if (prod && !["please", "tomorrow", "today", "deliver", "urgent", "order"].includes(prod.toLowerCase())) {
      requestedQuantities.push({ product: prod, quantity: qty, unit });
      mentionedProducts.push(prod);
    }
  }

  // Delivery date extraction
  let requestedDeliveryDate: string | null = null;
  if (lower.includes("tomorrow")) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    requestedDeliveryDate = tomorrow.toISOString().split("T")[0];
  } else if (lower.includes("today")) {
    requestedDeliveryDate = new Date().toISOString().split("T")[0];
  }

  // 1. Complaint
  if (
    lower.includes("complaint") ||
    lower.includes("damaged") ||
    lower.includes("broken") ||
    lower.includes("defective") ||
    lower.includes("terrible") ||
    lower.includes("wrong item") ||
    lower.includes("unacceptable")
  ) {
    return {
      intent: "COMPLAINT",
      confidence: 0.92,
      summary: "Customer reporting issue or grievance regarding goods or service.",
      customerSentiment: "FRUSTRATED",
      urgency: "HIGH",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: relatedOrderReference ? [] : ["Order number or invoice reference"],
      recommendedAction: "Review customer complaint, verify order records, and reach out to offer resolution.",
      requiresHumanReview: true,
    };
  }

  // 2. Cancellation
  if (
    lower.includes("cancel order") ||
    lower.includes("cancellation") ||
    lower.includes("want to cancel") ||
    lower.includes("please cancel")
  ) {
    return {
      intent: "ORDER_CANCELLATION",
      confidence: 0.94,
      summary: "Customer requested cancellation of order.",
      customerSentiment: "URGENT",
      urgency: "HIGH",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: relatedOrderReference ? [] : ["Order number to cancel"],
      recommendedAction: "Confirm order status before cancellation; check if already dispatched.",
      requiresHumanReview: true,
    };
  }

  // 3. Order modification
  if (
    (lower.includes("modify") || lower.includes("change") || lower.includes("update") || lower.includes("add more")) &&
    (lower.includes("order") || relatedOrderReference)
  ) {
    return {
      intent: "ORDER_MODIFICATION",
      confidence: 0.88,
      summary: "Customer requesting changes to an existing order.",
      customerSentiment: "NEUTRAL",
      urgency: "MEDIUM",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: requestedQuantities.length > 0 ? [] : ["Specific changes needed"],
      recommendedAction: "Review pending order and adjust order line items or quantities.",
      requiresHumanReview: true,
    };
  }

  // 4. Delivery enquiry
  if (
    lower.includes("tracking") ||
    lower.includes("where is my order") ||
    lower.includes("dispatch") ||
    lower.includes("delivery status") ||
    lower.includes("when will") ||
    lower.includes("track my") ||
    lower.includes("shipped")
  ) {
    return {
      intent: "DELIVERY_ENQUIRY",
      confidence: 0.91,
      summary: "Customer inquiring about shipment and delivery status.",
      customerSentiment: "NEUTRAL",
      urgency: "MEDIUM",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: relatedOrderReference ? [] : ["Order tracking reference"],
      recommendedAction: "Check fulfillment status and tracking details to provide delivery ETA.",
      requiresHumanReview: false,
    };
  }

  // 5. Payment enquiry
  if (
    lower.includes("payment") ||
    lower.includes("invoice") ||
    lower.includes("bank details") ||
    lower.includes("upi") ||
    lower.includes("paid") ||
    lower.includes("receipt")
  ) {
    return {
      intent: "PAYMENT_ENQUIRY",
      confidence: 0.89,
      summary: "Customer inquiring about payment, billing, or invoice.",
      customerSentiment: "NEUTRAL",
      urgency: "MEDIUM",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: [],
      recommendedAction: "Verify invoice or payment record in finance module and share status.",
      requiresHumanReview: false,
    };
  }

  // 6. Return / Refund
  if (
    lower.includes("return") ||
    lower.includes("refund") ||
    lower.includes("replace") ||
    lower.includes("replacement")
  ) {
    return {
      intent: "RETURN_OR_REFUND",
      confidence: 0.9,
      summary: "Customer requesting return or refund for goods.",
      customerSentiment: "FRUSTRATED",
      urgency: "HIGH",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: relatedOrderReference ? [] : ["Original order reference"],
      recommendedAction: "Inspect return policy eligibility and create return authorization.",
      requiresHumanReview: true,
    };
  }

  // 7. New Order
  if (
    lower.includes("need") ||
    lower.includes("order") ||
    lower.includes("buy") ||
    lower.includes("purchase") ||
    lower.includes("boxes of") ||
    lower.includes("units of") ||
    requestedQuantities.length > 0
  ) {
    const missing: string[] = [];
    if (requestedQuantities.length === 0) missing.push("Product names and quantities");
    if (!requestedDeliveryDate) missing.push("Preferred delivery date");

    return {
      intent: "NEW_ORDER",
      confidence: 0.93,
      summary: requestedQuantities.length > 0
        ? `Customer wants to order: ${requestedQuantities.map((q) => `${q.quantity} ${q.unit || "units"} ${q.product}`).join(", ")}.`
        : "Customer interested in placing a new order.",
      customerSentiment: "POSITIVE",
      urgency: lower.includes("urgent") || lower.includes("asap") || lower.includes("tomorrow") ? "HIGH" : "MEDIUM",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: missing,
      recommendedAction: "Create draft order from conversation and review product catalog prices.",
      requiresHumanReview: true,
    };
  }

  // 8. Product enquiry
  if (
    lower.includes("price") ||
    lower.includes("cost") ||
    lower.includes("catalogue") ||
    lower.includes("catalog") ||
    lower.includes("specs") ||
    lower.includes("available") ||
    lower.includes("in stock")
  ) {
    return {
      intent: "PRODUCT_ENQUIRY",
      confidence: 0.86,
      summary: "Customer inquiring about product pricing, availability, or specifications.",
      customerSentiment: "NEUTRAL",
      urgency: "LOW",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: mentionedProducts.length === 0 ? ["Specific product name or SKU"] : [],
      recommendedAction: "Share product catalog details, pricing, and stock availability.",
      requiresHumanReview: false,
    };
  }

  // 9. Follow up
  if (
    lower.includes("any update") ||
    lower.includes("following up") ||
    lower.includes("checking in") ||
    lower.includes("status update") ||
    lower.includes("did you check")
  ) {
    return {
      intent: "FOLLOW_UP",
      confidence: 0.87,
      summary: "Customer following up on a pending inquiry or request.",
      customerSentiment: "NEUTRAL",
      urgency: "MEDIUM",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: [],
      recommendedAction: "Review recent conversation history and reply with latest progress.",
      requiresHumanReview: true,
    };
  }

  // 10. General enquiry
  if (
    lower.includes("hi") ||
    lower.includes("hello") ||
    lower.includes("good morning") ||
    lower.includes("hours") ||
    lower.includes("location") ||
    lower.includes("address") ||
    lower.length < 50
  ) {
    return {
      intent: "GENERAL_ENQUIRY",
      confidence: 0.8,
      summary: text.slice(0, 100),
      customerSentiment: "NEUTRAL",
      urgency: "LOW",
      mentionedProducts,
      requestedQuantities,
      requestedDeliveryDate,
      relatedOrderReference,
      missingInformation: [],
      recommendedAction: "Send welcome greeting and assist with inquiry.",
      requiresHumanReview: false,
    };
  }

  // 11. Other
  return {
    intent: "OTHER",
    confidence: 0.7,
    summary: text.slice(0, 120),
    customerSentiment: "NEUTRAL",
    urgency: "LOW",
    mentionedProducts,
    requestedQuantities,
    requestedDeliveryDate,
    relatedOrderReference,
    missingInformation: [],
    recommendedAction: "Review message content manually.",
    requiresHumanReview: true,
  };
}

/**
 * Classifies an incoming message using DeepSeek LLM with structured output,
 * with automatic fallback to heuristic classification.
 */
export async function analyzeIncomingMessage(
  text: string,
  options: {
    customerName?: string;
    organizationId?: string;
  } = {},
): Promise<AiUnderstanding> {
  const trimmed = text.trim();
  if (!trimmed) {
    return classifyMessageHeuristic("");
  }

  // Attempt DeepSeek LLM structured classification if API key is present
  if (process.env.DEEPSEEK_API_KEY?.trim()) {
    try {
      const prompt = `
CUSTOMER MESSAGE:
"""
${trimmed}
"""

Analyze and return JSON with keys:
- intent (one of: GENERAL_ENQUIRY, PRODUCT_ENQUIRY, NEW_ORDER, ORDER_MODIFICATION, ORDER_CANCELLATION, COMPLAINT, DELIVERY_ENQUIRY, PAYMENT_ENQUIRY, RETURN_OR_REFUND, FOLLOW_UP, OTHER)
- confidence (number 0 to 1)
- summary (concise 1-2 sentence overview)
- customerSentiment (POSITIVE, NEUTRAL, FRUSTRATED, URGENT)
- urgency (LOW, MEDIUM, HIGH, CRITICAL)
- mentionedProducts (array of product names extracted)
- requestedQuantities (array of {product, quantity, unit})
- requestedDeliveryDate (ISO date string YYYY-MM-DD or null)
- relatedOrderReference (string or null)
- missingInformation (array of missing pieces of data needed to fulfill request)
- recommendedAction (actionable guidance for employee)
- requiresHumanReview (boolean)
`;

      const response = await completeDeepSeekJson({
        model: "deepseek-chat",
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: 0.1,
        maxTokens: 500,
      });

      const parsed = AiUnderstandingSchema.safeParse(response);
      if (parsed.success) {
        return parsed.data;
      }
      console.warn("AI Classification Zod parsing issue, falling back to heuristic:", parsed.error);
    } catch (err) {
      console.warn("AI DeepSeek completion failed, falling back to heuristic classifier:", err);
    }
  }

  // Use heuristic classifier
  return classifyMessageHeuristic(trimmed);
}
