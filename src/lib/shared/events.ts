/** Events streamed (as NDJSON) from POST /api/assistant to the client. */

export interface PublicSourceDto {
  n: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
  provider: string;
  credibility: "high" | "medium" | "low";
  credibilityReason: string;
  access: "read" | "snippet_only";
  accessNote?: string;
  mock: boolean;
}

export interface Claim {
  claim: string;
  sources: number[];
  note?: string;
}

export type AnswerMode = "direct" | "research" | "clarify" | "tool" | "memory" | "summary";

export interface FinalAnswer {
  mode: AnswerMode;
  /** Markdown shown on screen, with [n] citations for research answers. */
  text: string;
  /** Short plain text for text-to-speech. */
  spoken: string;
  sources: PublicSourceDto[];
  established: Claim[];
  disputed: Claim[];
  uncertainty: string;
  confidence: "high" | "medium" | "low" | "n/a";
  followUps: string[];
  /** True when any part came from a mock provider (no real AI or search was used). */
  mock: boolean;
  model: string;
  configVersion: string;
}

export interface MemoryProposal {
  id: string;
  kind: string;
  content: string;
}

export type AssistantEvent =
  | { type: "meta"; conversationId: string; userMessageId: string }
  | { type: "status"; stage: "thinking" | "routing" | "searching" | "reading" | "synthesizing" | "answering" | "tool"; detail?: string }
  | { type: "route"; action: string; question: string; complexity: string; model: string }
  | { type: "ignored"; reason: string }
  | { type: "sources"; sources: PublicSourceDto[] }
  | { type: "delta"; text: string }
  | { type: "answer"; answer: FinalAnswer }
  | { type: "warning"; message: string }
  | { type: "memory_saved"; memory: MemoryProposal }
  | { type: "memory_proposals"; items: MemoryProposal[] }
  | { type: "tool_result"; tool: string; summary: string; data?: unknown; clientAction?: { type: "open_url"; url: string } }
  | { type: "tool_confirmation"; tool: string; actionId: string; summary: string; risk: string }
  | { type: "error"; code: string; message: string }
  | { type: "done"; messageId: string | null; latencyMs: number };

export interface TranscriptSegment {
  /** ISO timestamp. */
  at: string;
  text: string;
  source?: "mic" | "system" | "typed" | "upload";
}

export interface AssistantRequest {
  text: string;
  trigger: "wake" | "ambient" | "typed" | "upload";
  conversationId?: string;
  transcript?: TranscriptSegment[];
  /** Force a mode, e.g. from a "Research this" button. */
  force?: "research" | "direct";
}
