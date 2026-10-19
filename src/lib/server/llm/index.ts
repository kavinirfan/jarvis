import "server-only";
import { config } from "../config";
import { gemini } from "./gemini";
import { mockLlm } from "./mock";
import type { LlmProvider } from "./types";

export * from "./types";

/**
 * Picks the model provider. Gemini when a key is configured; otherwise the clearly-labelled mock.
 * To add another vendor, implement LlmProvider in this folder and select it here (e.g. LLM_PROVIDER).
 */
export function getLlm(): LlmProvider {
  const c = config();
  if (c.providerMode === "mock" || !c.geminiKey) return mockLlm;
  return gemini;
}

export async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + dec.decode();
    out += dec.decode(value, { stream: true });
  }
}
