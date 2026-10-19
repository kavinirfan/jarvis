import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AssistantEvent, AssistantRequest, FinalAnswer } from "@/lib/shared/events";
import { hashPassword } from "../auth";
import { getDb, schema } from "../db/client";
import { runAssistant } from "../reasoning/engine";
import { getActiveConfig, getConfigVersion } from "../reasoning/promptConfig";

/**
 * Evaluates a prompt/model configuration against a stable test set plus the user-approved
 * examples collected from feedback. Scores are simple and transparent (no model grades itself):
 *
 *   route     — did it research when it should (and not when it shouldn't)?
 *   relevance — fraction of expected key points present in the answer
 *   grounding — fraction of research-answer sentences that carry a citation
 *   citations — research answers cite only real sources (no invented [n])
 *   tools     — the expected tool was used
 *   latency   — mean seconds per answer
 */
export interface EvalCase {
  id: string;
  text: string;
  trigger?: AssistantRequest["trigger"];
  /** true: must research; false: must not; undefined: either. */
  expectResearch?: boolean;
  expectMode?: FinalAnswer["mode"] | "ignored";
  expectTool?: string;
  expectedPoints?: string[];
}

export const STABLE_SET: EvalCase[] = [
  { id: "fact-boiling", text: "What is the boiling point of water at sea level in Celsius?", expectResearch: false, expectedPoints: ["100"] },
  { id: "explain-hash", text: "Explain what a hash table is in two sentences.", expectResearch: false, expectedPoints: ["key", "value"] },
  { id: "fact-author", text: "Who wrote Pride and Prejudice?", expectedPoints: ["Austen"] },
  { id: "research-hubble", text: "Research when the Hubble Space Telescope was launched and by which shuttle.", expectResearch: true, expectedPoints: ["1990", "Discovery"] },
  { id: "research-current", text: "What is the current population of Japan according to recent estimates?", expectResearch: true, expectedPoints: ["million"] },
  { id: "tool-task", text: "Add a task to buy AA batteries", expectMode: "tool", expectTool: "add_task" },
  { id: "memory-cmd", text: "Remember that I enjoy jazz", expectMode: "memory" },
  { id: "ambient-chatter", text: "the kettle is boiling again", trigger: "ambient", expectMode: "ignored" },
];

export interface CaseResult {
  id: string;
  mode: string;
  latencyMs: number;
  scores: Partial<Record<"route" | "relevance" | "grounding" | "citations" | "tools" | "mode", number>>;
  error?: string;
  answer?: string;
}

async function evalUser(): Promise<string> {
  const db = await getDb();
  const email = "eval@jarvis.local";
  const row = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1))[0];
  if (row) return row.id;
  // Random password nobody knows: this account exists only to own evaluation data.
  const [u] = await db.insert(schema.users).values({ email, passwordHash: await hashPassword(randomBytes(24).toString("hex")), displayName: "Evaluation" }).returning({ id: schema.users.id });
  return u.id;
}

async function runCase(userId: string, c: EvalCase, version: string): Promise<CaseResult> {
  const cfg = version ? await getConfigVersion(version) : await getActiveConfig();
  const evs: AssistantEvent[] = [];
  const t0 = Date.now();
  try {
    await runAssistant(userId, { text: c.text, trigger: c.trigger ?? "typed" }, (e) => evs.push(e), undefined, { config: cfg });
  } catch (e) {
    return { id: c.id, mode: "error", latencyMs: Date.now() - t0, scores: {}, error: (e as Error).message };
  }
  const latencyMs = Date.now() - t0;
  const answer = (evs.find((e) => e.type === "answer") as { answer: FinalAnswer } | undefined)?.answer;
  const ignored = evs.some((e) => e.type === "ignored");
  const mode = ignored ? "ignored" : (answer?.mode ?? "none");
  const scores: CaseResult["scores"] = {};
  if (c.expectResearch !== undefined) scores.route = (mode === "research") === c.expectResearch ? 1 : 0;
  if (c.expectMode) scores.mode = mode === c.expectMode ? 1 : 0;
  if (c.expectTool) scores.tools = evs.some((e) => (e.type === "tool_result" || e.type === "tool_confirmation") && e.tool === c.expectTool) ? 1 : 0;
  const text = answer?.text ?? "";
  if (c.expectedPoints?.length) scores.relevance = c.expectedPoints.filter((p) => text.toLowerCase().includes(p.toLowerCase())).length / c.expectedPoints.length;
  if (mode === "research" && answer) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 20);
    scores.grounding = sentences.length ? sentences.filter((s) => /\[\d/.test(s)).length / sentences.length : 0;
    const removed = evs.some((e) => e.type === "warning" && /citation\(s\) that didn't match/.test(e.message));
    scores.citations = !removed && /\[\d/.test(text) ? 1 : 0;
  }
  return { id: c.id, mode, latencyMs, scores, answer: text.slice(0, 300) };
}

export async function runEvaluation(opts: { version?: string; includeApproved?: boolean; onCase?: (r: CaseResult) => void } = {}) {
  const db = await getDb();
  const version = opts.version ?? (await getActiveConfig()).version;
  const userId = await evalUser();
  const cases = [...STABLE_SET];
  if (opts.includeApproved !== false) {
    const approved = await db.select().from(schema.evalCases).where(eq(schema.evalCases.approved, true)).limit(50);
    for (const a of approved) cases.push({ id: `user-${a.id.slice(0, 8)}`, text: a.question, expectResearch: a.expectResearch || undefined, expectedPoints: a.expectedPoints });
  }
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = await runCase(userId, c, version);
    results.push(r);
    opts.onCase?.(r);
  }
  // Clean up data created by the evaluation account.
  await db.delete(schema.conversations).where(eq(schema.conversations.userId, userId));
  await db.delete(schema.tasks).where(eq(schema.tasks.userId, userId));
  await db.delete(schema.notes).where(eq(schema.notes.userId, userId));
  await db.delete(schema.memories).where(eq(schema.memories.userId, userId));

  const mean = (k: keyof CaseResult["scores"]) => {
    const v = results.map((r) => r.scores[k]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  const scores: Record<string, number> = {
    route: mean("route"),
    mode: mean("mode"),
    relevance: mean("relevance"),
    grounding: mean("grounding"),
    citations: mean("citations"),
    tools: mean("tools"),
    errors: results.filter((r) => r.error).length,
    latencySec: results.reduce((a, r) => a + r.latencyMs, 0) / results.length / 1000,
    cases: results.length,
  };
  for (const k of Object.keys(scores)) if (Number.isNaN(scores[k])) delete scores[k];
  await db.insert(schema.evalRuns).values({ configVersion: version, scores, results });
  return { version, scores, results };
}
