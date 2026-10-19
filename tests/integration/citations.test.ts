import { beforeAll, describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { getDb, schema } from "@/lib/server/db/client";
import type { LlmProvider, LlmRequest } from "@/lib/server/llm";
import { runAssistant } from "@/lib/server/reasoning/engine";
import type { AssistantEvent, FinalAnswer } from "@/lib/shared/events";
import { call, freshDb } from "./helpers";

/** A scripted model: routes to research, then returns the given synthesis JSON. */
function scripted(synthesis: Record<string, unknown>): LlmProvider {
  const out = (req: LlmRequest) =>
    req.task === "router"
      ? JSON.stringify({ action: "research", addressedToJarvis: true, standaloneQuestion: "When did Hubble launch?", clarifyingQuestion: "", complexity: "simple", needsFreshInfo: false, recency: "none", searchQueries: ["Hubble launch"], tool: { name: "", argsJson: "{}" } })
      : JSON.stringify({ spoken: "x", established: [], disputed: [], uncertainty: "", confidence: "high", followUps: [], ...synthesis });
  return { id: "scripted", mock: true, generate: async (r) => out(r), stream: async () => new ReadableStream({ start: (c) => c.close() }) };
}

let userId = "";
beforeAll(async () => {
  freshDb();
  await call(register, { body: { email: "cite@example.com", password: "citation password" } });
  userId = (await (await getDb()).select().from(schema.users))[0].id;
});

async function answerFor(llm: LlmProvider): Promise<{ answer: FinalAnswer; events: AssistantEvent[] }> {
  const events: AssistantEvent[] = [];
  await runAssistant(userId, { text: "When did Hubble launch?", trigger: "typed" }, (e) => events.push(e), undefined, { llm });
  const a = events.find((e) => e.type === "answer") as { answer: FinalAnswer };
  return { answer: a.answer, events };
}

describe("research answers always carry their evidence", () => {
  it("removes invented citation numbers and warns", async () => {
    const { answer, events } = await answerFor(scripted({ answer: "Launched in 1990 [1] aboard Discovery [42]." }));
    expect(answer.text).toBe("Launched in 1990 [1] aboard Discovery .");
    expect(events.some((e) => e.type === "warning" && /didn't match a real source/.test(e.message))).toBe(true);
  });

  it("attaches the claim sources when the model forgot inline citations", async () => {
    const { answer } = await answerFor(scripted({ answer: "Launched in 1990 aboard Discovery.", established: [{ claim: "Launched in 1990", sources: [2, 1] }] }));
    expect(answer.text).toBe("Launched in 1990 aboard Discovery. [1, 2]");
  });

  it("marks an answer with no evidence at all as low-confidence and unverified", async () => {
    const { answer } = await answerFor(scripted({ answer: "Launched in 1990 aboard Discovery." }));
    expect(answer.confidence).toBe("low");
    expect(answer.uncertainty).toMatch(/unverified/);
  });
});
