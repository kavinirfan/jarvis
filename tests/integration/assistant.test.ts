import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as actionRoute } from "@/app/api/actions/[id]/route";
import { POST as assistant } from "@/app/api/assistant/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as configsGet, POST as configsPost } from "@/app/api/configs/route";
import { GET as convList } from "@/app/api/conversations/route";
import { POST as feedback } from "@/app/api/feedback/route";
import { DELETE as memDelete, PATCH as memPatch } from "@/app/api/memories/[id]/route";
import { GET as memExport } from "@/app/api/memories/export/route";
import { GET as memList, POST as memCreate } from "@/app/api/memories/route";
import { GET as status } from "@/app/api/status/route";
import { resetConfigForTests } from "@/lib/server/config";
import { getDb, schema } from "@/lib/server/db/client";
import { createCandidate } from "@/lib/server/reasoning/promptConfig";
import { proposeTool } from "@/lib/server/tools/registry";
import { assertBudget, recordUsage } from "@/lib/server/usage";
import { call, cookieFrom, events, freshDb } from "./helpers";

let alice = "";
let alice2 = ""; // a second signed-in session/device for the same account
let bob = "";

async function ask(cookie: string, body: Record<string, unknown>) {
  const r = await call(assistant, { cookie, body });
  expect(r.status).toBe(200);
  return events(r);
}

beforeAll(async () => {
  freshDb();
  process.env.JARVIS_ALLOW_REGISTRATION = "true";
  resetConfigForTests();
  alice = cookieFrom(await call(register, { body: { email: "alice@example.com", password: "alice password 123" } }));
  bob = cookieFrom(await call(register, { body: { email: "bob@example.com", password: "bob password 1234" } }));
  alice2 = cookieFrom(await call(login, { body: { email: "alice@example.com", password: "alice password 123" } }));
  process.env.JARVIS_ALLOW_REGISTRATION = "";
  resetConfigForTests();
});

describe("reasoning workflow (mock providers)", () => {
  let conversationId = "";

  it("answers a typed question and labels mock output", async () => {
    const ev = await ask(alice, { text: "What is photosynthesis?", trigger: "typed" });
    const meta = ev.find((e) => e.type === "meta")!;
    conversationId = meta.conversationId;
    const route = ev.find((e) => e.type === "route")!;
    expect(route.action).toBe("agent");
    const answer = ev.find((e) => e.type === "answer")!.answer;
    expect(answer.mock).toBe(true);
    expect(answer.text).toMatch(/^\[MOCK\]/);
    expect(ev.at(-1)?.type).toBe("done");
  });

  it("researches when asked, with mock sources clearly flagged", async () => {
    const ev = await ask(alice, { text: "What is the latest news about Mars?", trigger: "typed", conversationId });
    expect(ev.some((e) => e.type === "status" && e.stage === "searching")).toBe(true);
    const answer = ev.find((e) => e.type === "answer")!.answer;
    expect(answer.mode).toBe("research");
    expect(answer.sources.length).toBeGreaterThan(0);
    expect(answer.sources.every((s: { mock: boolean; url: string }) => s.mock && s.url.startsWith("https://example.com/mock/"))).toBe(true);
    expect(answer.text).toContain("[1]");
  });

  it("handles follow-ups using the previous answer", async () => {
    const ev = await ask(alice, { text: "Explain that again", trigger: "wake", conversationId });
    const answer = ev.find((e) => e.type === "answer")!.answer;
    expect(answer.mode).toBe("direct");
    expect(ev.some((e) => e.type === "route")).toBe(false); // deterministic follow-up, no router call
  });

  it("summarizes a timestamped transcript window", async () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    const ev = await ask(alice, {
      text: "Summarize the last five minutes",
      trigger: "typed",
      transcript: [
        { at: old, text: "Something from half an hour ago.", source: "mic" },
        { at: now, text: "We moved the launch to Friday.", source: "mic" },
      ],
    });
    expect(ev.find((e) => e.type === "answer")!.answer.mode).toBe("summary");
  });

  it("ignores ambient chatter without calling the model", async () => {
    const db = await getDb();
    const before = (await db.select().from(schema.usageEvents)).length;
    const ev = await ask(alice, { text: "yeah I left my keys on the table", trigger: "ambient" });
    expect(ev.map((e) => e.type)).toEqual(["ignored", "done"]);
    expect((await db.select().from(schema.usageEvents)).length).toBe(before);
  });

  it("lists conversation history and searches it", async () => {
    const list = await (await call(convList, { cookie: alice })).json();
    expect(list.conversations.length).toBeGreaterThan(0);
    const hits = await (await call(convList, { cookie: alice, path: "/api/conversations?q=photosynthesis" })).json();
    expect(hits.hits.length).toBeGreaterThan(0);
    const bobs = await (await call(convList, { cookie: bob })).json();
    expect(bobs.conversations).toHaveLength(0);
  });

  it("stores feedback and approved evaluation examples", async () => {
    const db = await getDb();
    const msg = (await db.select().from(schema.messages).where(eq(schema.messages.role, "assistant")).limit(1))[0];
    expect((await call(feedback, { cookie: bob, body: { messageId: msg.id, rating: 1 } })).status).toBe(404); // not Bob's
    expect((await call(feedback, { cookie: alice, body: { messageId: msg.id, rating: -1, addToEval: true } })).status).toBe(200);
    const cases = await db.select().from(schema.evalCases);
    expect(cases).toHaveLength(1);
    expect(cases[0].approved).toBe(true);
  });
});

describe("memory", () => {
  it("saves explicit 'remember that' commands as approved memories", async () => {
    const ev = await ask(alice, { text: "Hey Jarvis, remember that I prefer metric units", trigger: "wake" });
    expect(ev.some((e) => e.type === "memory_saved")).toBe(true);
  });

  it("syncs memories to another signed-in session of the same account", async () => {
    const list = await (await call(memList, { cookie: alice2 })).json();
    expect(list.memories.map((m: { content: string }) => m.content)).toContain("I prefer metric units");
  });

  it("keeps memories private between accounts", async () => {
    const mine = await (await call(memList, { cookie: alice })).json();
    const id = mine.memories[0].id;
    expect((await (await call(memList, { cookie: bob })).json()).memories).toHaveLength(0);
    expect((await call(memDelete, { method: "DELETE", cookie: bob, params: { id } })).status).toBe(404);
    expect((await call(memPatch, { method: "PATCH", cookie: bob, params: { id }, body: { content: "hacked" } })).status).toBe(404);
  });

  it("edits, exports and deletes memories", async () => {
    const created = await (await call(memCreate, { cookie: alice, body: { kind: "project", content: "Building JARVIS" } })).json();
    expect(created.memory.status).toBe("approved");
    const edited = await (await call(memPatch, { method: "PATCH", cookie: alice, params: { id: created.memory.id }, body: { content: "Building JARVIS v2" } })).json();
    expect(edited.memory.content).toBe("Building JARVIS v2");
    const exp = await (await call(memExport, { cookie: alice })).json();
    expect(exp.memories.length).toBe(2);
    expect((await call(memDelete, { method: "DELETE", cookie: alice, params: { id: created.memory.id } })).status).toBe(200);
  });

  it("does not store memories when memory is disabled", async () => {
    const { PUT } = await import("@/app/api/settings/route");
    await call(PUT, { method: "PUT", cookie: bob, body: { memoryEnabled: false } });
    const ev = await ask(bob, { text: "remember that my password is hunter2", trigger: "typed" });
    expect(ev.some((e) => e.type === "memory_saved")).toBe(false);
    expect((await (await call(memList, { cookie: bob })).json()).memories).toHaveLength(0);
  });

  it("only gives approved memories to the model", async () => {
    const db = await getDb();
    const [{ id: aliceId }] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "alice@example.com"));
    await db.insert(schema.memories).values({ userId: aliceId, kind: "inference", content: "Unapproved guess about metric", status: "proposed" });
    const { relevantMemories } = await import("@/lib/server/memory");
    const mems = await relevantMemories(aliceId, "metric units");
    expect(mems.map((m) => m.content)).toContain("I prefer metric units");
    expect(mems.map((m) => m.content)).not.toContain("Unapproved guess about metric");
  });
});

describe("tools and confirmations", () => {
  it("runs low-risk tools immediately", async () => {
    const ev = await ask(alice, { text: "Hey Jarvis, create a note called shopping list", trigger: "wake" });
    expect(ev.some((e) => e.type === "tool_result" && e.tool === "create_note")).toBe(true);
    const db = await getDb();
    expect((await db.select().from(schema.notes)).length).toBe(1);
  });

  it("rejects unknown tools and invalid arguments", async () => {
    const db = await getDb();
    const [{ id }] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "alice@example.com"));
    expect((await proposeTool({ userId: id, device: false }, "run_shell", { cmd: "rm -rf /" })).status).toBe("rejected");
    expect((await proposeTool({ userId: id, device: false }, "open_website", { url: "javascript:alert(1)" })).status).toBe("rejected");
    expect((await proposeTool({ userId: id, device: false }, "open_website", { url: "http://insecure.example.com" })).status).toBe("rejected");
  });

  it("requires confirmation for sensitive tools, only by the owner, only once", async () => {
    const db = await getDb();
    const [{ id }] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "alice@example.com"));
    const p = await proposeTool({ userId: id, device: false }, "delete_notes", { title: "shopping" });
    expect(p.status).toBe("needs_confirmation");
    if (p.status !== "needs_confirmation") return;
    expect((await db.select().from(schema.notes)).length).toBe(1); // nothing happened yet
    expect((await call(actionRoute, { cookie: bob, params: { id: p.actionId }, body: { approve: true } })).status).toBe(404);
    const ok = await call(actionRoute, { cookie: alice, params: { id: p.actionId }, body: { approve: true } });
    expect(ok.status).toBe(200);
    expect((await db.select().from(schema.notes)).length).toBe(0);
    expect((await call(actionRoute, { cookie: alice, params: { id: p.actionId }, body: { approve: true } })).status).toBe(404);
    const audit = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.userId, id), eq(schema.auditLog.action, "tool:delete_notes")));
    expect(audit.map((a) => a.status).sort()).toEqual(["ok", "pending"]);
  });
});

describe("evolution: versioned configs, budget", () => {
  it("activates a candidate config and rolls back", async () => {
    const initial = await (await call(configsGet, { cookie: alice })).json();
    const active = initial.configs.find((c: { status: string }) => c.status === "active").version;
    await createCandidate("test.1", { temperature: 0.1 }, "lower temperature");
    // Bob isn't the owner.
    expect((await call(configsPost, { cookie: bob, body: { action: "activate", version: "test.1" } })).status).toBe(403);
    expect((await call(configsPost, { cookie: alice, body: { action: "activate", version: "test.1" } })).status).toBe(200);
    const st = await (await call(status, { cookie: alice })).json();
    expect(st.config).toBe("test.1");
    const rb = await (await call(configsPost, { cookie: alice, body: { action: "rollback" } })).json();
    expect(rb.active).toBe(active);
  });

  it("enforces the daily usage budget", async () => {
    process.env.JARVIS_DAILY_REQUEST_BUDGET = "3";
    resetConfigForTests();
    const db = await getDb();
    const [{ id }] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "bob@example.com"));
    await db.delete(schema.usageEvents);
    for (let i = 0; i < 3; i++) await recordUsage(id, "llm", "mock");
    await expect(assertBudget(id)).rejects.toMatchObject({ status: 429, code: "budget_exceeded" });
    const res = await call(assistant, { cookie: bob, body: { text: "hello there jarvis", trigger: "typed" } });
    expect(res.status).toBe(429);
    process.env.JARVIS_DAILY_REQUEST_BUDGET = "";
    resetConfigForTests();
  });
});
