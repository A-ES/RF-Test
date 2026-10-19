import type { ExtractedOrderLine } from "./understand";
import { completeDeepSeekJson } from "@/app/lib/deepseek";

export interface CandidateProduct {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  score: number;
}

export interface MatchedOrderLine {
  rawText: string;
  productId: string | null;
  sku: string;
  name: string;
  quantity: number | null;
  unit: string;
  matchConfidence: number;
  flags: string[];
  candidates?: CandidateProduct[];
}

export interface ProductCatalogItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  basePriceMinor: number;
  aliases: Array<{ alias: string }>;
}

export interface MatchOptions {
  completeJson?: typeof completeDeepSeekJson;
}

interface ProductDbClient {
  product: {
    findMany: (args: {
      where: { organizationId: string; isActive: boolean };
      include: { aliases: true };
    }) => Promise<ProductCatalogItem[]>;
  };
}

/**
 * 5. Matching Order:
 * exact SKU -> alias -> normalised name -> fuzzy similarity -> LLM tie-break restricted to top 5 candidates.
 * Never invent SKUs.
 * Confidence below 0.8 or two close candidates => UNCLEAR_PRODUCT flag with candidates stored on the line.
 */
export async function matchOrderLines(
  lines: ExtractedOrderLine[],
  organizationId: string,
  db: ProductDbClient,
  options: MatchOptions = {},
): Promise<MatchedOrderLine[]> {
  const products = await db.product.findMany({
    where: { organizationId, isActive: true },
    include: { aliases: true },
  });

  const matched: MatchedOrderLine[] = [];

  for (const line of lines) {
    const result = await matchSingleLine(line, products, options);
    matched.push(result);
  }

  return matched;
}

async function matchSingleLine(
  line: ExtractedOrderLine,
  products: ProductCatalogItem[],
  options: MatchOptions,
): Promise<MatchedOrderLine> {
  const rawCleaned = cleanRawText(line.rawText);

  // 1. Exact SKU match
  if (line.requestedSku) {
    const exactSku = products.find(
      (p) => p.sku.toLowerCase() === line.requestedSku!.toLowerCase(),
    );
    if (exactSku) {
      return {
        rawText: line.rawText,
        productId: exactSku.id,
        sku: exactSku.sku,
        name: exactSku.name,
        quantity: line.quantity ?? null,
        unit: line.unit || exactSku.unit,
        matchConfidence: 1.0,
        flags: [],
      };
    }
  }

  const skuFromText = products.find(
    (p) => p.sku.toLowerCase() === rawCleaned.toLowerCase(),
  );
  if (skuFromText) {
    return {
      rawText: line.rawText,
      productId: skuFromText.id,
      sku: skuFromText.sku,
      name: skuFromText.name,
      quantity: line.quantity ?? null,
      unit: line.unit || skuFromText.unit,
      matchConfidence: 1.0,
      flags: [],
    };
  }

  // 2. Exact alias match
  const aliasMatch = products.find((p) =>
    p.aliases.some((a) => a.alias.toLowerCase() === rawCleaned.toLowerCase()),
  );
  if (aliasMatch) {
    return {
      rawText: line.rawText,
      productId: aliasMatch.id,
      sku: aliasMatch.sku,
      name: aliasMatch.name,
      quantity: line.quantity ?? null,
      unit: line.unit || aliasMatch.unit,
      matchConfidence: 0.98,
      flags: [],
    };
  }

  // 3. Normalised name match
  const normTarget = normalizeString(rawCleaned);
  const nameMatch = products.find(
    (p) => normalizeString(p.name) === normTarget,
  );
  if (nameMatch) {
    return {
      rawText: line.rawText,
      productId: nameMatch.id,
      sku: nameMatch.sku,
      name: nameMatch.name,
      quantity: line.quantity ?? null,
      unit: line.unit || nameMatch.unit,
      matchConfidence: 0.95,
      flags: [],
    };
  }

  // 4. Fuzzy similarity across name and aliases
  const scoredCandidates: Array<{
    product: ProductCatalogItem;
    score: number;
  }> = [];

  for (const product of products) {
    let bestScore = stringSimilarity(normTarget, normalizeString(product.name));

    // Also test raw name
    const rawScore = stringSimilarity(rawCleaned.toLowerCase(), product.name.toLowerCase());
    if (rawScore > bestScore) bestScore = rawScore;

    // Check against aliases
    for (const a of product.aliases) {
      const aliasScore = stringSimilarity(normTarget, normalizeString(a.alias));
      if (aliasScore > bestScore) bestScore = aliasScore;
    }

    scoredCandidates.push({ product, score: bestScore });
  }

  scoredCandidates.sort((a, b) => b.score - a.score);

  const top1 = scoredCandidates[0];
  const top2 = scoredCandidates[1];

  // Restrict to top 5 candidates
  const top5 = scoredCandidates.slice(0, 5).map((c) => ({
    productId: c.product.id,
    sku: c.product.sku,
    name: c.product.name,
    unit: c.product.unit,
    score: Math.round(c.score * 100) / 100,
  }));

  // Clear single fuzzy match: high score and solid gap
  if (top1 && top1.score >= 0.85 && (!top2 || top1.score - top2.score > 0.15)) {
    return {
      rawText: line.rawText,
      productId: top1.product.id,
      sku: top1.product.sku,
      name: top1.product.name,
      quantity: line.quantity ?? null,
      unit: line.unit || top1.product.unit,
      matchConfidence: Math.round(top1.score * 100) / 100,
      flags: [],
    };
  }

  // 5. LLM tie-break restricted to top 5 candidates
  const completeJson = options.completeJson ?? completeDeepSeekJson;
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (top5.length > 0 && (apiKey || options.completeJson)) {
    try {
      const systemPrompt = `You are a product SKU matcher. Given the customer's text, select the single best matching product from the top 5 candidates provided below.
CRITICAL RULES:
- Choose ONLY from the provided candidates list. NEVER invent SKUs.
- If there is no clear match or if multiple products are equally likely, return matchedSku: null.
- Output JSON format:
{
  "matchedSku": string | null,
  "confidence": number, // 0.0 to 1.0
  "reason": string
}`;

      const userPrompt = `Customer Requested Line: ${JSON.stringify(line.rawText)}
Candidates:
${JSON.stringify(
  top5.map((c) => ({ sku: c.sku, name: c.name })),
  null,
  2,
)}`;

      const res = await completeJson({
        model: "deepseek-chat",
        temperature: 0.0,
        maxTokens: 150,
        systemPrompt,
        userPrompt,
      });

      const matchedSku = typeof res.matchedSku === "string" ? res.matchedSku.trim() : null;
      const confidence = typeof res.confidence === "number" ? res.confidence : 0.0;

      const chosen = top5.find(
        (c) => c.sku.toLowerCase() === (matchedSku || "").toLowerCase(),
      );

      if (chosen && confidence >= 0.8) {
        // Verify not two close candidates
        const secondCandidate = top5.find((c) => c.sku !== chosen.sku);
        const isTie =
          secondCandidate && Math.abs(chosen.score - secondCandidate.score) < 0.05 && confidence < 0.85;

        if (!isTie) {
          return {
            rawText: line.rawText,
            productId: chosen.productId,
            sku: chosen.sku,
            name: chosen.name,
            quantity: line.quantity ?? null,
            unit: line.unit || chosen.unit,
            matchConfidence: confidence,
            flags: [],
          };
        }
      }
    } catch {
      // Proceed to ambiguity evaluation
    }
  }

  // Check if two close candidates or low confidence (< 0.8)
  const isTwoClose = top1 && top2 && Math.abs(top1.score - top2.score) <= 0.1;
  const isLowConfidence = !top1 || top1.score < 0.8;

  if (isTwoClose || isLowConfidence) {
    return {
      rawText: line.rawText,
      productId: top1 ? top1.product.id : null,
      sku: top1 ? top1.product.sku : line.requestedSku || "UNKNOWN",
      name: top1 ? top1.product.name : line.rawText,
      quantity: line.quantity ?? null,
      unit: line.unit || (top1 ? top1.product.unit : "PCS"),
      matchConfidence: top1 ? Math.round(top1.score * 100) / 100 : 0.0,
      flags: ["UNCLEAR_PRODUCT"],
      candidates: top5,
    };
  }

  return {
    rawText: line.rawText,
    productId: top1.product.id,
    sku: top1.product.sku,
    name: top1.product.name,
    quantity: line.quantity ?? null,
    unit: line.unit || top1.product.unit,
    matchConfidence: Math.round(top1.score * 100) / 100,
    flags: [],
  };
}

/**
 * Strips quantities, units, and noise words to isolate product name.
 */
function cleanRawText(raw: string): string {
  const cleaned = raw
    .replace(
      /^\s*\d+\s*(cases?|units?|peti|dabbe|boxes?|packs?|kg|pcs|pieces?|cs|unts|cses)?\s*(?:of\s+)?/i,
      "",
    )
    .replace(/\b(delivered\s+tomorrow|kal\s+bhej\s+do|kal|tomorrow|today|aaj)\b/gi, "")
    .replace(/^(please\s+send\s+|send\s+me\s+|send\s+|i\s+need\s+|bhai\s+|chahiye\s+)/i, "")
    .trim();

  return cleaned || raw.trim();
}

/**
 * Normalises string for comparison.
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes Levenshtein-based string similarity (0.0 to 1.0).
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  // Substring bonus
  if (a.includes(b) || b.includes(a)) {
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    return Math.max(0.85, minLen / maxLen);
  }

  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - dist / maxLen);
}

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}
