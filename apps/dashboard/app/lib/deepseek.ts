import type { RetrievedSource } from "@/app/lib/retrieval";

export class DeepSeekConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekConfigError";
  }
}

export class DeepSeekRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekRequestError";
  }
}

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";

const SYSTEM_PROMPT = [
  "You are RF Intelligence, an assistant embedded in a multi-tenant business operations dashboard.",
  "You answer questions using ONLY the CONTEXT provided by the server.",
  "The CONTEXT contains records belonging to exactly ONE organization.",
  "Never mention, infer, compare, or reference any other organization or any data that is not in the CONTEXT.",
  "If the CONTEXT does not contain enough information to answer, say so plainly instead of guessing.",
  "When you use a fact from a source, cite it inline using its tag, e.g. [S1].",
  "Be concise and factual. Do not invent numbers, accounts, people, or dates.",
].join(" ");

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function buildMessages(
  question: string,
  sources: RetrievedSource[],
): ChatMessage[] {
  const context =
    sources.length === 0
      ? "(no matching records were found in this organization's workspace)"
      : sources
          .map(
            (source, index) =>
              `[S${index + 1}] (${source.type}) ${source.title}\n${source.summary}`,
          )
          .join("\n\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `QUESTION:\n${question}\n\nCONTEXT (this organization only):\n${context}`,
    },
  ];
}

/**
 * Sends the question plus the pre-retrieved, tenant-scoped context to DeepSeek.
 * No other data is ever included in the request.
 */
export async function askDeepSeek(
  question: string,
  sources: RetrievedSource[],
): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new DeepSeekConfigError("DEEPSEEK_API_KEY is not configured");
  }

  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(question, sources),
      temperature: 0.2,
      stream: false,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DeepSeekRequestError(
      `DeepSeek API responded with ${response.status}: ${detail.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new DeepSeekRequestError("DeepSeek returned an empty response");
  }

  return content.trim();
}

export interface DeepSeekJsonRequest {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Chat completion that must return a JSON object (DeepSeek json_object mode).
 */
export async function completeDeepSeekJson(
  request: DeepSeekJsonRequest,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new DeepSeekConfigError("DEEPSEEK_API_KEY is not configured");
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: false,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DeepSeekRequestError(
      `DeepSeek API responded with ${response.status}: ${detail.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!raw) {
    throw new DeepSeekRequestError("DeepSeek returned an empty response");
  }

  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new DeepSeekRequestError(`DeepSeek returned non-JSON: ${clean.slice(0, 200)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DeepSeekRequestError("DeepSeek JSON was not an object");
  }
  return parsed as Record<string, unknown>;
}
