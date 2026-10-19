import "server-only";
import { config } from "../config";
import { AppError } from "../errors";
import { geminiSseToText } from "./sse";
import type { AgentStepRequest, AgentStepResult, FunctionCall, LlmProvider, LlmRequest, RawContent, ThinkingLevel } from "./types";

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

export function geminiKey(): string {
  const key = config().geminiKey;
  if (!key) throw new AppError(503, "missing_key", "No Gemini API key is configured. Add GEMINI_API_KEY to .env.local and restart.");
  return key;
}

export function describeGeminiError(status: number, detail: string): AppError {
  if (status === 429) return new AppError(429, "rate_limited", "Gemini's rate limit or quota was reached. Wait a moment and try again.");
  if ((status === 400 && /api key/i.test(detail)) || status === 401 || status === 403)
    return new AppError(502, "bad_key", "Gemini rejected the API key. Check GEMINI_API_KEY in .env.local.");
  if (status === 404) return new AppError(502, "bad_model", "A configured Gemini model wasn't found. Check the GEMINI_*_MODEL settings.");
  // Never echo upstream bodies verbatim; they can contain request details.
  return new AppError(502, "upstream_error", `Gemini returned an error (${status}).`);
}

export async function geminiFetch(path: string, body: unknown, signal?: AbortSignal, timeoutMs = 60_000): Promise<Response> {
  const key = geminiKey();
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_API}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError" && signal?.aborted) throw e;
    if ((e as Error).name === "TimeoutError") throw new AppError(504, "timeout", "Gemini took too long to respond.");
    throw new AppError(502, "network", "Couldn't reach Gemini. Check the internet connection.");
  }
  return res;
}

const TRANSIENT = new Set([500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Models that recently hit their quota are skipped for a while instead of being retried every request. */
const cooldown = new Map<string, number>();

/**
 * The preferred model followed by fallbacks. When a model is overloaded (5xx) or out of quota
 * (429), the next one answers instead, so JARVIS stays up on the free tier.
 */
export function modelChain(preferred: string): string[] {
  const c = config();
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.7-flash,gemini-3.5-flash").split(",").map((s) => s.trim()).filter(Boolean);
  const chain = [...new Set([preferred, ...(preferred === c.models.fast ? [] : fallbacks), c.models.fast])];
  const now = Date.now();
  const ready = chain.filter((m) => (cooldown.get(m) ?? 0) < now);
  return ready.length ? ready : chain;
}

function thinkingFor(speed: LlmRequest["speed"], level?: ThinkingLevel): ThinkingLevel {
  return level ?? (speed === "fast" ? "minimal" : "low");
}

async function postWithFallback(
  preferred: string,
  path: (model: string) => string,
  body: (withThinking: boolean) => unknown,
  signal?: AbortSignal,
): Promise<{ res: Response; model: string }> {
  let last: Response | null = null;
  let lastModel = preferred;
  const chain = modelChain(preferred);
  for (const [i, model] of chain.entries()) {
    // Overloaded models are skipped quickly; only the last resort gets a retry.
    const attempts = i === chain.length - 1 ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await sleep(700);
      let res = await geminiFetch(path(model), body(true), signal);
      if (res.status === 400) {
        const detail = await res.clone().text();
        // Some models don't accept a thinking level; retry once without it.
        if (/thinking/i.test(detail)) res = await geminiFetch(path(model), body(false), signal);
      }
      last = res;
      lastModel = model;
      if (res.ok) return { res, model };
      if (res.status === 429) {
        cooldown.set(model, Date.now() + 2 * 60_000);
        break; // try the next model
      }
      if (!TRANSIENT.has(res.status)) return { res, model }; // a real error: don't mask it
      // Overloaded: let later requests (e.g. the next agent step) skip it for a minute.
      if (i < chain.length - 1) cooldown.set(model, Date.now() + 60_000);
    }
    console.warn(`[jarvis] ${model} unavailable (${last?.status}); trying a fallback model`);
  }
  return { res: last!, model: lastModel };
}

function buildBody(req: LlmRequest, withThinking: boolean) {
  const generationConfig: Record<string, unknown> = {
    temperature: req.temperature ?? 0.5,
    maxOutputTokens: req.maxOutputTokens ?? 2048,
  };
  if (withThinking) generationConfig.thinkingConfig = { thinkingLevel: thinkingFor(req.speed, req.thinking) };
  if (req.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = req.jsonSchema;
  }
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: m.parts.map((p) => (p.type === "text" ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.data } })),
    })),
    generationConfig,
  };
}

async function call(req: LlmRequest, streaming: boolean): Promise<Response> {
  const preferred = req.model || (req.speed === "fast" ? config().models.fast : config().models.balanced);
  const { res, model } = await postWithFallback(
    preferred,
    (m) => (streaming ? `models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse` : `models/${encodeURIComponent(m)}:generateContent`),
    (t) => buildBody(req, t),
    req.signal,
  );
  if (!res.ok) throw describeGeminiError(res.status, await res.text().catch(() => ""));
  req.onModel?.(model);
  return res;
}

type Candidate = { content?: RawContent; finishReason?: string };

export const gemini: LlmProvider = {
  id: "gemini",
  mock: false,

  async stream(req) {
    const res = await call(req, true);
    if (!res.body) throw new AppError(502, "upstream_error", "Gemini returned an empty stream.");
    return geminiSseToText(res.body);
  },

  async generate(req) {
    const res = await call(req, false);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) throw new AppError(422, "blocked", `Gemini declined the request (${data.promptFeedback.blockReason}).`);
    const out = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    if (!out) throw new AppError(502, "empty", "Gemini returned an empty response.");
    return out;
  },

  async agentStep(req: AgentStepRequest): Promise<AgentStepResult> {
    const preferred = req.model || (req.speed === "fast" ? config().models.fast : config().models.balanced);
    const body = (withThinking: boolean) => ({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.contents,
      tools: req.tools.length ? [{ functionDeclarations: req.tools }] : undefined,
      generationConfig: {
        temperature: req.temperature ?? 0.6,
        maxOutputTokens: req.maxOutputTokens ?? 4096,
        ...(withThinking ? { thinkingConfig: { thinkingLevel: thinkingFor(req.speed, req.thinking) } } : {}),
      },
    });
    const { res, model } = await postWithFallback(preferred, (m) => `models/${encodeURIComponent(m)}:generateContent`, body, req.signal);
    if (!res.ok) throw describeGeminiError(res.status, await res.text().catch(() => ""));
    const data = (await res.json()) as { candidates?: Candidate[]; promptFeedback?: { blockReason?: string } };
    if (data.promptFeedback?.blockReason) throw new AppError(422, "blocked", `Gemini declined the request (${data.promptFeedback.blockReason}).`);
    const content: RawContent = { role: "model", parts: data.candidates?.[0]?.content?.parts ?? [] };
    const calls: FunctionCall[] = content.parts
      .filter((p) => p.functionCall)
      .map((p) => ({ id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args ?? {} }));
    const text = content.parts
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text as string)
      .join("")
      .trim();
    if (!calls.length && !text) throw new AppError(502, "empty", "Gemini returned an empty response.");
    return { content, text, calls, model };
  },

  async embed(texts: string[]): Promise<number[][]> {
    const model = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2";
    const res = await geminiFetch(
      `models/${model}:batchEmbedContents`,
      { requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t.slice(0, 4000) }] }, outputDimensionality: 256 })) },
      undefined,
      20_000,
    );
    if (!res.ok) throw describeGeminiError(res.status, await res.text().catch(() => ""));
    const data = (await res.json()) as { embeddings?: { values: number[] }[] };
    return (data.embeddings ?? []).map((e) => e.values);
  },
};
