import "server-only";
import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { getLlm, userMsg, type LlmProvider } from "./llm";
import { createMemory, type Memory } from "./memory";
import { recordUsage } from "./usage";

/**
 * How JARVIS learns over time — all of it visible and erasable by the user:
 *
 *  1. Semantic memory: approved memories are embedded and recalled by meaning, not keywords.
 *  2. Auto-learning: durable facts the user states are saved automatically (when enabled).
 *  3. Episodic memory: conversations are summarized and can be recalled later ("what did we
 *     discuss about the trip last week?").
 *  4. Reflection: every few conversations JARVIS reviews feedback, summaries and memories and
 *     rewrites a short list of "learned behaviors" + a user profile that shape future answers.
 *
 * None of this retrains the underlying model; it changes what JARVIS knows and how it's instructed.
 */

// ---------------------------------------------------------------- embeddings

const DIM = 256;

/** Deterministic bag-of-words vector, used when no embedding API is available (offline/tests). */
export function hashEmbedding(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % DIM] += 1;
  }
  return v;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function embedTexts(texts: string[], llm: LlmProvider = getLlm()): Promise<number[][]> {
  if (!texts.length) return [];
  if (llm.embed && !llm.mock) {
    try {
      const out = await llm.embed(texts);
      if (out.length === texts.length) return out;
    } catch (e) {
      console.warn("[jarvis] embedding failed, using keyword vectors:", (e as Error).message);
    }
  }
  return texts.map(hashEmbedding);
}

/** Embeds approved memories that don't have a vector yet (or whose vector size is stale). */
async function ensureMemoryEmbeddings(userId: string, llm: LlmProvider) {
  const db = await getDb();
  const missing = await db
    .select({ id: schema.memories.id, content: schema.memories.content })
    .from(schema.memories)
    .where(and(eq(schema.memories.userId, userId), eq(schema.memories.status, "approved"), isNull(schema.memories.embedding)))
    .limit(64);
  if (!missing.length) return;
  const vectors = await embedTexts(missing.map((m) => m.content), llm);
  for (let i = 0; i < missing.length; i++) {
    await db.update(schema.memories).set({ embedding: vectors[i] }).where(eq(schema.memories.id, missing[i].id));
  }
}

// ---------------------------------------------------------------- recall

/** Approved memories most related to `query` by meaning, plus recent preferences. */
export async function recallMemories(userId: string, query: string, k = 8, llm: LlmProvider = getLlm()): Promise<Memory[]> {
  const db = await getDb();
  await ensureMemoryEmbeddings(userId, llm).catch(() => {});
  const all = await db
    .select()
    .from(schema.memories)
    .where(and(eq(schema.memories.userId, userId), eq(schema.memories.status, "approved"), sql`(${schema.memories.expiresAt} is null or ${schema.memories.expiresAt} > now())`))
    .limit(1000);
  if (!all.length) return [];
  const [q] = await embedTexts([query], llm);
  const sameSpace = (e: number[] | null) => !!e && e.length === q.length;
  const scored = all
    .map((m) => ({ m, s: sameSpace(m.embedding) ? cosine(q, m.embedding!) : cosine(hashEmbedding(query), hashEmbedding(m.content)) }))
    .sort((a, b) => b.s - a.s);
  const threshold = llm.mock || !llm.embed ? 0.15 : 0.45;
  const picked = scored.filter((x) => x.s >= threshold).slice(0, k).map((x) => x.m);
  for (const p of all.filter((m) => m.kind === "preference").sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 4)) {
    if (!picked.some((x) => x.id === p.id) && picked.length < k + 2) picked.push(p);
  }
  if (picked.length) {
    await db
      .update(schema.memories)
      .set({ useCount: sql`${schema.memories.useCount} + 1`, lastUsedAt: new Date() })
      .where(sql`${schema.memories.id} in (${sql.join(picked.map((p) => sql`${p.id}`), sql`, `)})`);
  }
  return picked;
}

/** Past conversations related to `query` (by their summaries). */
export async function recallConversations(userId: string, query: string, k = 3, excludeId?: string, llm: LlmProvider = getLlm()) {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.conversations.id, title: schema.conversations.title, summary: schema.conversations.summary, embedding: schema.conversations.summaryEmbedding, updatedAt: schema.conversations.updatedAt })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.userId, userId), sql`${schema.conversations.summary} <> ''`))
    .orderBy(desc(schema.conversations.updatedAt))
    .limit(200);
  const candidates = rows.filter((r) => r.id !== excludeId);
  if (!candidates.length) return [];
  const [q] = await embedTexts([query], llm);
  return candidates
    .map((r) => ({ r, s: r.embedding && r.embedding.length === q.length ? cosine(q, r.embedding) : cosine(hashEmbedding(query), hashEmbedding(r.summary)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .filter((x) => x.s > (llm.mock || !llm.embed ? 0.1 : 0.35))
    .map(({ r }) => ({ id: r.id, title: r.title, summary: r.summary, when: r.updatedAt.toISOString().slice(0, 10) }));
}

// ---------------------------------------------------------------- auto-learning

const PERSONAL =
  /\b(i am|i'm|i was|i work|i live|i prefer|i like|i love|i hate|i don't like|i usually|i always|i never|i want|i need|i have|my [a-z]+|call me|i'm building|i'm working on|we are|we're|our [a-z]+)\b/i;

const MEMORY_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: { kind: { type: "string", enum: ["fact", "preference", "project", "inference"] }, content: { type: "string" }, confidence: { type: "number" } },
        required: ["kind", "content", "confidence"],
      },
    },
  },
  required: ["memories"],
};

/**
 * Extracts durable facts about the user from what they said. With auto-learning on, confident
 * facts are saved straight away (the user is told and can delete them); otherwise they're proposed.
 */
export async function learnFromUtterance(userId: string, text: string, autoApprove: boolean, llm: LlmProvider = getLlm()) {
  if (!PERSONAL.test(text) || llm.mock) return [];
  const db = await getDb();
  const known = await db.select({ content: schema.memories.content }).from(schema.memories).where(eq(schema.memories.userId, userId)).orderBy(desc(schema.memories.updatedAt)).limit(40);
  const raw = await llm.generate({
    task: "memory_extract",
    system:
      "Extract at most 3 durable facts about the USER worth remembering for future conversations: stable preferences, ongoing projects, personal facts they stated about themselves. " +
      "Skip one-off requests, anything already known, and sensitive data (passwords, financial or health details, government IDs, other people's private details). " +
      "Write each as a short third-person statement (e.g. 'Prefers metric units'). kind=inference only for things implied but not stated. Return an empty list when nothing qualifies.",
    messages: [userMsg(`Already known:\n${known.map((k) => `- ${k.content}`).join("\n") || "(nothing)"}\n\n<utterance>${text}</utterance>`)],
    speed: "fast",
    temperature: 0,
    maxOutputTokens: 400,
    jsonSchema: MEMORY_SCHEMA,
  });
  await recordUsage(userId, "llm", llm.id, { detail: { task: "memory_extract" } });
  const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as { memories: { kind: "fact" | "preference" | "project" | "inference"; content: string; confidence: number }[] };
  const out: { id: string; kind: string; content: string; status: string }[] = [];
  for (const m of parsed.memories ?? []) {
    const content = m.content?.trim();
    if (!content || content.length > 400) continue;
    const approve = autoApprove && m.kind !== "inference" && (m.confidence ?? 0) >= 0.7;
    const row = await createMemory(userId, { kind: m.kind, content, status: approve ? "approved" : "proposed", source: "assistant", confidence: m.confidence });
    out.push({ id: row.id, kind: row.kind, content: row.content, status: row.status });
  }
  return out;
}

// ---------------------------------------------------------------- episodic memory

/** Summarizes a conversation once enough new messages have accumulated. */
export async function maybeSummarizeConversation(userId: string, conversationId: string, llm: LlmProvider = getLlm()) {
  if (llm.mock) return;
  const db = await getDb();
  const conv = (await db.select().from(schema.conversations).where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.userId, userId))).limit(1))[0];
  if (!conv) return;
  const [{ n }] = await db.select({ n: count() }).from(schema.messages).where(and(eq(schema.messages.conversationId, conversationId), sql`${schema.messages.role} in ('user','assistant')`));
  if (Number(n) - conv.summarizedCount < 6) return;
  const msgs = await db
    .select({ role: schema.messages.role, content: schema.messages.content })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), sql`${schema.messages.role} in ('user','assistant')`))
    .orderBy(asc(schema.messages.createdAt))
    .limit(60);
  const transcript = msgs.map((m) => `${m.role === "user" ? "User" : "JARVIS"}: ${m.content.slice(0, 600)}`).join("\n");
  const summary = await llm.generate({
    task: "conversation_summary",
    system: "Summarize this conversation between the user and JARVIS in 2-4 sentences for JARVIS's long-term memory: topics, conclusions, decisions, open items. Plain text.",
    messages: [userMsg(`${conv.summary ? `Previous summary: ${conv.summary}\n\n` : ""}${transcript}`)],
    speed: "fast",
    temperature: 0.2,
    maxOutputTokens: 300,
  });
  const [vec] = await embedTexts([summary], llm);
  await db.update(schema.conversations).set({ summary: summary.trim(), summaryEmbedding: vec, summarizedCount: Number(n) }).where(eq(schema.conversations.id, conversationId));
  await recordUsage(userId, "llm", llm.id, { detail: { task: "conversation_summary" } });
}

// ---------------------------------------------------------------- reflection

export async function activeInsights(userId: string) {
  const db = await getDb();
  return db.select().from(schema.insights).where(and(eq(schema.insights.userId, userId), eq(schema.insights.active, true))).orderBy(asc(schema.insights.createdAt));
}

const REFLECT_SCHEMA = {
  type: "object",
  properties: {
    profile: { type: "string" },
    behaviors: { type: "array", items: { type: "string" }, maxItems: 8 },
    outdatedMemoryIds: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: ["profile", "behaviors", "outdatedMemoryIds"],
};

/** True when enough has happened since the last reflection to be worth another one. */
export async function reflectionDue(userId: string, every = 8): Promise<boolean> {
  const db = await getDb();
  const last = (await db.select({ at: schema.insights.createdAt }).from(schema.insights).where(eq(schema.insights.userId, userId)).orderBy(desc(schema.insights.createdAt)).limit(1))[0];
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.messages)
    .where(and(eq(schema.messages.userId, userId), eq(schema.messages.role, "assistant"), last ? gt(schema.messages.createdAt, last.at) : sql`true`));
  return Number(n) >= every;
}

/**
 * Reviews recent feedback, conversation summaries and memories, then rewrites JARVIS's learned
 * behaviors and user profile (a new generation; the previous one is kept inactive for history).
 */
export async function reflect(userId: string, llm: LlmProvider = getLlm()) {
  if (llm.mock) return null;
  const db = await getDb();
  const [fb, convs, mems, current] = await Promise.all([
    db
      .select({ rating: schema.feedback.rating, comment: schema.feedback.comment, answer: schema.messages.content, meta: schema.messages.meta })
      .from(schema.feedback)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.feedback.messageId))
      .where(eq(schema.feedback.userId, userId))
      .orderBy(desc(schema.feedback.createdAt))
      .limit(20),
    db.select({ summary: schema.conversations.summary, title: schema.conversations.title }).from(schema.conversations).where(eq(schema.conversations.userId, userId)).orderBy(desc(schema.conversations.updatedAt)).limit(15),
    db.select({ id: schema.memories.id, kind: schema.memories.kind, content: schema.memories.content, useCount: schema.memories.useCount }).from(schema.memories).where(and(eq(schema.memories.userId, userId), eq(schema.memories.status, "approved"))).limit(80),
    activeInsights(userId),
  ]);
  const recentQuestions = await db
    .select({ content: schema.messages.content })
    .from(schema.messages)
    .where(and(eq(schema.messages.userId, userId), eq(schema.messages.role, "user")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(30);

  const prompt = [
    `Current learned behaviors:\n${current.filter((i) => i.kind === "behavior").map((i) => `- ${i.content}`).join("\n") || "(none)"}`,
    `Current profile:\n${current.find((i) => i.kind === "profile")?.content ?? "(none)"}`,
    `Feedback on answers (rating +1/-1, comment, question):\n${fb.map((f) => `${f.rating > 0 ? "+1" : "-1"} ${f.comment ? `"${f.comment}" ` : ""}Q: ${String(f.meta.question ?? "").slice(0, 160)} | A: ${f.answer.slice(0, 200)}`).join("\n") || "(none)"}`,
    `Recent conversations:\n${convs.map((c) => `- ${c.title}${c.summary ? `: ${c.summary}` : ""}`).join("\n") || "(none)"}`,
    `Recent questions:\n${recentQuestions.map((q) => `- ${q.content.slice(0, 160)}`).join("\n")}`,
    `Memories (id | kind | content):\n${mems.map((m) => `${m.id} | ${m.kind} | ${m.content}`).join("\n") || "(none)"}`,
  ].join("\n\n");

  const raw = await llm.generate({
    task: "reflection",
    system:
      "You are JARVIS reflecting on how to serve this one user better. Based ONLY on the evidence given:\n" +
      "- profile: 2-4 sentences describing who the user is, what they care about and how they like to be helped.\n" +
      "- behaviors: up to 8 short, specific instructions for yourself (e.g. 'Lead with the answer; they dislike long intros', 'Use metric units', 'They're learning to code: explain jargon briefly'). Keep good existing ones, fix ones contradicted by feedback, drop unsupported ones. Never include instructions that reduce honesty, safety or confirmation of sensitive actions.\n" +
      "- outdatedMemoryIds: ids of memories that are duplicates or clearly superseded by newer ones.",
    messages: [userMsg(prompt)],
    speed: "balanced",
    thinking: "medium",
    temperature: 0.3,
    maxOutputTokens: 1200,
    jsonSchema: REFLECT_SCHEMA,
  });
  await recordUsage(userId, "llm", llm.id, { detail: { task: "reflection" } });
  const r = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as { profile: string; behaviors: string[]; outdatedMemoryIds: string[] };
  const generation = (current[0]?.generation ?? 0) + 1;
  await db.transaction(async (tx) => {
    await tx.update(schema.insights).set({ active: false }).where(and(eq(schema.insights.userId, userId), eq(schema.insights.active, true)));
    const rows = [
      ...(r.profile?.trim() ? [{ userId, kind: "profile", content: r.profile.trim().slice(0, 1000), generation }] : []),
      ...(r.behaviors ?? []).filter((b) => b?.trim()).slice(0, 8).map((b) => ({ userId, kind: "behavior", content: b.trim().slice(0, 300), generation })),
    ];
    if (rows.length) await tx.insert(schema.insights).values(rows);
    const valid = new Set(mems.map((m) => m.id));
    const stale = (r.outdatedMemoryIds ?? []).filter((id) => valid.has(id));
    if (stale.length) await tx.delete(schema.memories).where(and(eq(schema.memories.userId, userId), sql`${schema.memories.id} in (${sql.join(stale.map((id) => sql`${id}`), sql`, `)})`));
  });
  return { generation, profile: r.profile, behaviors: r.behaviors, removedMemories: r.outdatedMemoryIds?.length ?? 0 };
}

/** Runs summarization and (when due) reflection in the background after a turn. Never throws. */
export function afterTurn(userId: string, conversationId: string, opts: { reflection: boolean }) {
  void (async () => {
    try {
      await maybeSummarizeConversation(userId, conversationId);
      if (opts.reflection && (await reflectionDue(userId))) await reflect(userId);
    } catch (e) {
      console.warn("[jarvis] background learning failed:", (e as Error).message);
    }
  })();
}
