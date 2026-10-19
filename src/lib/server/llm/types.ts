/**
 * Provider-neutral model interface. The reasoning engine talks to this, never to a vendor API,
 * so adding OpenAI or Anthropic means adding one file in this folder.
 */
export type LlmPart = { type: "text"; text: string } | { type: "inline"; mimeType: string; data: string };

export interface LlmMessage {
  role: "user" | "assistant";
  parts: LlmPart[];
}

export type LlmSpeed = "fast" | "balanced";
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  speed?: LlmSpeed;
  /** Overrides the model chosen by `speed` (used by versioned prompt configs). */
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** When set, the model must return JSON matching this JSON Schema. */
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Names the workflow step (router, synthesis, ...) for telemetry and the mock provider. */
  task?: string;
  /** Called with the model that actually produced the response (it can differ after a fallback). */
  onModel?: (model: string) => void;
  /** How much the model reasons before answering. Defaults: fast → minimal, balanced → low. */
  thinking?: ThinkingLevel;
}

/** Native multi-turn content for tool-using (agent) steps. Parts are kept verbatim, including
 * any provider metadata (e.g. Gemini thought signatures) that must be sent back unchanged. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawPart = Record<string, any>;
export interface RawContent {
  role: "user" | "model";
  parts: RawPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface FunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentStepRequest {
  system: string;
  contents: RawContent[];
  tools: FunctionDeclaration[];
  speed?: LlmSpeed;
  model?: string;
  thinking?: ThinkingLevel;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  task?: string;
}

export interface AgentStepResult {
  /** The model's turn, verbatim, to append to `contents`. */
  content: RawContent;
  text: string;
  calls: FunctionCall[];
  model: string;
}

export interface LlmProvider {
  id: string;
  /** True for the mock provider, so answers can be labelled as not real AI output. */
  mock: boolean;
  stream(req: LlmRequest): Promise<ReadableStream<Uint8Array>>;
  generate(req: LlmRequest): Promise<string>;
  /** One step of a tool-using conversation. Optional: providers without it use the simpler pipeline. */
  agentStep?(req: AgentStepRequest): Promise<AgentStepResult>;
  /** Text embeddings for semantic memory search. Optional. */
  embed?(texts: string[]): Promise<number[][]>;
}

export const text = (t: string): LlmPart => ({ type: "text", text: t });
export const userMsg = (t: string): LlmMessage => ({ role: "user", parts: [text(t)] });
