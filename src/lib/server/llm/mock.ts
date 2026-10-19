import type { AgentStepRequest, AgentStepResult, LlmProvider, LlmRequest } from "./types";

/**
 * Deterministic stand-in used when no API key is configured (or JARVIS_PROVIDER_MODE=mock).
 * Every answer starts with "[MOCK]" and the UI shows a "Mock output" badge, so it can never be
 * mistaken for real AI output. Its routing uses simple keyword rules.
 */
function lastUserText(req: LlmRequest): string {
  const m = [...req.messages].reverse().find((x) => x.role === "user");
  const t = m?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ") ?? "";
  const q = t.match(/<utterance>([\s\S]*?)<\/utterance>/)?.[1] ?? t.match(/<question>([\s\S]*?)<\/question>/)?.[1] ?? t;
  return q.trim();
}

function mockOutput(req: LlmRequest): string {
  const q = lastUserText(req);
  switch (req.task) {
    case "router": {
      const lower = q.toLowerCase();
      const isQuestion = /\?|^(what|who|when|where|why|how|is|are|can|could|tell|explain|look up)/.test(lower.replace(/^(hey )?jarvis,?\s*/, ""));
      const ambient = /trigger: ambient/.test(req.messages.map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")).join(""));
      const tool = lower.match(/\b(?:create|make|take|add) (?:a )?note\b.*?(?:called|titled|:)?\s*(.*)$/) ? "create_note" : /\badd (?:a )?task\b/.test(lower) ? "add_task" : "";
      const research = /\b(latest|today|current|news|price|who won|this week|recent|look up|search)\b/.test(lower);
      return JSON.stringify({
        action: tool ? "tool" : ambient && !isQuestion ? "ignore" : research ? "research" : "answer",
        addressedToJarvis: /jarvis/i.test(q) || !ambient,
        standaloneQuestion: q.replace(/^(hey )?jarvis,?\s*/i, ""),
        clarifyingQuestion: "",
        complexity: research ? "moderate" : "simple",
        needsFreshInfo: research,
        recency: research ? "month" : "none",
        searchQueries: research ? [q.replace(/^(hey )?jarvis,?\s*/i, "").slice(0, 100)] : [],
        tool: tool ? { name: tool, argsJson: JSON.stringify(tool === "create_note" ? { title: q.slice(0, 60), body: q } : { title: q.slice(0, 80) }) } : { name: "", argsJson: "{}" },
      });
    }
    case "synthesis":
      return JSON.stringify({
        answer: `[MOCK] This is a mock research answer about "${q}" based on placeholder source [1]. No real AI or web search was used.`,
        spoken: "This is a mock answer. No real AI or web search was used.",
        established: [{ claim: "[MOCK] Placeholder claim", sources: [1] }],
        disputed: [],
        uncertainty: "Mock mode: nothing here is real.",
        confidence: "low",
        followUps: ["[MOCK] Follow-up question?"],
      });
    case "memory_extract":
      return JSON.stringify({ memories: [] });
    default:
      return `[MOCK] JARVIS is running without an AI provider. You asked: "${q.slice(0, 200)}". Add GEMINI_API_KEY to .env.local for real answers.`;
  }
}

/** Keyword-driven tool use, so the agent loop can be exercised without a real model. */
function mockAgentStep(req: AgentStepRequest): AgentStepResult {
  const last = req.contents[req.contents.length - 1];
  const responses = last?.parts.filter((p) => p.functionResponse) ?? [];
  const reply = (text: string): AgentStepResult => ({ content: { role: "model", parts: [{ text }] }, text, calls: [], model: "mock" });
  if (responses.length) {
    const names = responses.map((p) => p.functionResponse.name).join(", ");
    return reply(`[MOCK] Done using ${names}.`);
  }
  const userText = (last?.parts.map((p) => p.text ?? "").join(" ") ?? "").toLowerCase();
  const available = new Set(req.tools.map((t) => t.name));
  const call = (name: string, args: Record<string, unknown>): AgentStepResult =>
    available.has(name)
      ? { content: { role: "model", parts: [{ functionCall: { name, args } }] }, text: "", calls: [{ name, args }], model: "mock" }
      : reply(`[MOCK] I can't use ${name} here.`);
  const q = userText.split("\n").pop()!.replace(/^(hey )?jarvis,?\s*/, "").trim();
  if (/\b(latest|news|research|search|look up|current)\b/.test(userText)) return call("web_research", { query: q.slice(0, 100) });
  if (/\b(create|make|take) (a )?note\b/.test(userText)) return call("create_note", { title: q.slice(0, 60), body: q });
  if (/\badd (a )?task\b/.test(userText)) return call("add_task", { title: q.slice(0, 80) });
  if (/\b(battery|system status)\b/.test(userText)) return call("system_status", {});
  if (/\bdelete (my )?notes?\b/.test(userText)) return call("delete_notes", { title: q.slice(0, 40) });
  return reply(`[MOCK] JARVIS is running without an AI provider. You asked: "${q.slice(0, 200)}". Add GEMINI_API_KEY to .env.local for real answers.`);
}

export const mockLlm: LlmProvider = {
  id: "mock",
  mock: true,
  async generate(req) {
    return mockOutput(req);
  },
  async agentStep(req) {
    return mockAgentStep(req);
  },
  async stream(req) {
    const text = mockOutput(req);
    const enc = new TextEncoder();
    const words = text.split(/(?<= )/);
    return new ReadableStream({
      async pull(c) {
        const w = words.shift();
        if (w === undefined) return c.close();
        await new Promise((r) => setTimeout(r, 5));
        c.enqueue(enc.encode(w));
      },
    });
  },
};
