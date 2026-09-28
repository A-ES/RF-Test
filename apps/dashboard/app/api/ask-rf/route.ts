import { getSession } from "@/app/lib/session";
import { retrieveContext } from "@/app/lib/retrieval";
import { rateLimit } from "@/app/lib/rate-limit";
import { prisma } from "@/app/lib/db";
import { getOrgDataVersion } from "@/app/lib/data-sync";
import {
  OUT_OF_SCOPE_MESSAGE,
  DOCUMENT_RELEVANCE_THRESHOLD,
  PRODUCT_KNOWLEDGE,
  PROMPT_VERSION,
} from "@/lib/ask-rf/domain-config";
import { buildSystemPrompt } from "@/lib/ask-rf/system-prompt";
import { classifyRequest, type RequestCategory } from "@/lib/ask-rf/classifier";
import {
  computeCacheKey,
  getFromCache,
  saveToCache,
} from "@/lib/ask-rf/cache";
import {
  executeGetTeamMembers,
  executeGetProjects,
  executeGetInsights,
  executeGetCustomerConversations,
  executeGetReports,
  executeSearchDocuments,
  executeGetAccountInfo,
  type ToolContext,
} from "@/lib/ask-rf/tools";

import { askDeepSeek, DeepSeekConfigError } from "@/app/lib/deepseek";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 4000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function sanitizeInput(text: string): string {
  // Strip control characters except newline and tab
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

function json(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return Response.json(body, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  const startTime = Date.now();
  let stageLatencies: Record<string, number> = {};

  // 1. Session Authentication & Scoping
  const session = await getSession();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Identity is strictly anchored to session
  const orgId = session.organizationId;
  const userId = session.userId;
  const userName = session.name || "User";
  const userRole = session.role || "MEMBER";

  const toolCtx: ToolContext = {
    organizationId: orgId,
    userId,
    userRole,
  };

  // 2. Parse & Validate Payload
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as {
    question?: unknown;
    regenerate?: unknown;
    history?: Array<{ sender: string; text: string }>;
  };

  const rawQuestion = typeof body.question === "string" ? body.question : "";
  const question = sanitizeInput(rawQuestion);
  const isRegenerate = Boolean(body.regenerate);
  const history = Array.isArray(body.history) ? body.history : [];

  if (!question) {
    return json({ error: "A non-empty 'question' is required" }, 400);
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return json(
      { error: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer` },
      400,
    );
  }

  // 3. Per-user Rate Limiting (10 req / min)
  const limit = rateLimit(
    `ask-rf:${userId}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!limit.allowed) {
    return json({ error: "Too many requests. Please slow down." }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const modelId = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const orgDataVersion = getOrgDataVersion(orgId);

  // 4. Cache Lookup (Phase 6)
  const cacheKey = computeCacheKey({
    prompt: question,
    organizationId: orgId,
    userId,
    userRole,
    modelId,
    history,
  });

  if (!isRegenerate) {
    const cachedEntry = getFromCache(cacheKey, orgId);
    if (cachedEntry) {
      return json(
        {
          answer: cachedEntry.answer,
          sources: cachedEntry.sources,
          tier: cachedEntry.tier,
          cached: true,
          dataVersion: orgDataVersion,
        },
        200,
        { "X-Ask-Cache": "HIT" }
      );
    }
  }

  const classifyStart = Date.now();
  // 5. Classification (A, B, C, D)
  const category: RequestCategory = await classifyRequest(question);
  stageLatencies.classification = Date.now() - classifyStart;

  // 6. Handling Category D: OUT_OF_SCOPE
  if (category === "OUT_OF_SCOPE") {
    const refusalEntry = {
      answer: OUT_OF_SCOPE_MESSAGE,
      sources: [],
      tier: "OUT_OF_SCOPE",
      dataVersion: orgDataVersion,
      ttlMs: 24 * 3600 * 1000, // 24h
    };
    saveToCache(cacheKey, refusalEntry);

    return json(
      {
        answer: OUT_OF_SCOPE_MESSAGE,
        sources: [],
        tier: "OUT_OF_SCOPE",
        cached: false,
        dataVersion: orgDataVersion,
      },
      200,
      { "X-Ask-Cache": "MISS" }
    );
  }

  // 7. Workspace Sources Retrieval
  const dbStart = Date.now();
  const rawSources = await retrieveContext(orgId, question);
  const dbRetrievalTime = Date.now() - dbStart;

  const finalSources = rawSources.map((source, index) => ({
    id: source.id,
    type: source.type,
    title: source.title,
    label: `S${index + 1}`,
  }));

  let answer: string;
  const modelStart = Date.now();
  try {
    answer = await askDeepSeek(question, rawSources);
  } catch (error) {
    if (error instanceof DeepSeekConfigError) {
      return json({ error: "Ask RF is not configured." }, 503);
    }
    console.error("Ask RF: DeepSeek request failed", error);
    return json(
      { error: "Ask RF is temporarily unavailable. Please try again." },
      502,
    );
  }
  const modelTime = Date.now() - modelStart;

  // 8. Audit trail persistence to prisma.askRfQuery
  const auditStart = Date.now();
  try {
    await prisma.askRfQuery.create({
      data: {
        organizationId: orgId,
        userId: userId,
        queryText: question,
        answerText: answer,
        sourcesJson: JSON.stringify(rawSources.map((source) => source.id)),
      },
    });
  } catch (error) {
    console.error("Ask RF: failed to persist query log", error);
  }
  const totalDbTime = dbRetrievalTime + (Date.now() - auditStart);

  // 9. Cache Answer
  saveToCache(cacheKey, {
    answer,
    sources: finalSources,
    tier: category,
    dataVersion: orgDataVersion,
    ttlMs: 10 * 60 * 1000,
  });

  // Observability & Analytics logging
  const { trackEvent } = await import("@/app/lib/analytics");
  trackEvent("ask_rf_query_asked", { category, questionLength: question.length }, { organizationId: orgId, userId });

  const totalDuration = Date.now() - startTime;
  console.log(JSON.stringify({
    event: "ask_rf_query",
    tier: category,
    cached: false,
    durationMs: totalDuration,
    dbMs: totalDbTime,
    modelMs: modelTime,
    orgId,
    userId,
  }));

  return json(
    {
      answer,
      sources: finalSources,
      tier: category,
      cached: false,
      dataVersion: orgDataVersion,
      metrics: {
        dbMs: totalDbTime,
        modelMs: modelTime,
        totalMs: totalDuration,
      },
    },
    200,
    {
      "X-Ask-Cache": "MISS",
      "Server-Timing": `db;dur=${totalDbTime}, model;dur=${modelTime}, total;dur=${totalDuration}`,
    }
  );
}

async function callDeepSeekWithPrompt(
  systemPrompt: string,
  question: string,
  context: string
): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return "Ask RF is currently operating in offline mode. Please configure DEEPSEEK_API_KEY for generative responses.";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `CONTEXT:\n${context}\n\nQUESTION:\n${question}` },
        ],
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || "No response generated.";
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

