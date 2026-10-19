import "server-only";
import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db/client";
import { AppError } from "./errors";

export const MEMORY_KINDS = ["fact", "preference", "project", "inference"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const memoryInput = z.object({
  kind: z.enum(MEMORY_KINDS),
  content: z.string().trim().min(2).max(1000),
});

export type Memory = typeof schema.memories.$inferSelect;

const notExpired = () => or(isNull(schema.memories.expiresAt), sql`${schema.memories.expiresAt} > now()`);

export async function listMemories(userId: string, opts: { status?: "proposed" | "approved"; q?: string } = {}) {
  const db = await getDb();
  const conds = [eq(schema.memories.userId, userId), notExpired()];
  if (opts.status) conds.push(eq(schema.memories.status, opts.status));
  if (opts.q) conds.push(ilike(schema.memories.content, `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`));
  return db.select().from(schema.memories).where(and(...conds)).orderBy(desc(schema.memories.updatedAt)).limit(500);
}

/**
 * Approved memories relevant to `text`: full-text matches first, then the most recent
 * preferences, capped so the prompt stays small.
 */
export async function relevantMemories(userId: string, text: string, limit = 8): Promise<Memory[]> {
  const db = await getDb();
  const base = and(eq(schema.memories.userId, userId), eq(schema.memories.status, "approved"), notExpired());
  const words = (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 12);
  let matches: Memory[] = [];
  if (words.length) {
    matches = await db
      .select()
      .from(schema.memories)
      .where(and(base, sql`to_tsvector('english', ${schema.memories.content}) @@ to_tsquery('english', ${words.join(" | ")})`))
      .orderBy(desc(sql`ts_rank(to_tsvector('english', ${schema.memories.content}), to_tsquery('english', ${words.join(" | ")}))`))
      .limit(limit);
  }
  const prefs = await db
    .select()
    .from(schema.memories)
    .where(and(base, eq(schema.memories.kind, "preference")))
    .orderBy(desc(schema.memories.updatedAt))
    .limit(4);
  const seen = new Set<string>();
  return [...matches, ...prefs].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, limit);
}

export async function createMemory(
  userId: string,
  input: { kind: MemoryKind; content: string; status: "proposed" | "approved"; source: "user" | "assistant"; confidence?: number },
) {
  const db = await getDb();
  // Skip exact duplicates of an existing memory.
  const dup = await db
    .select()
    .from(schema.memories)
    .where(and(eq(schema.memories.userId, userId), sql`lower(${schema.memories.content}) = lower(${input.content})`))
    .limit(1);
  if (dup[0]) {
    if (input.status === "approved" && dup[0].status !== "approved") return updateMemory(userId, dup[0].id, { status: "approved" });
    return dup[0];
  }
  const [row] = await db
    .insert(schema.memories)
    .values({ userId, kind: input.kind, content: input.content, status: input.status, source: input.source, confidence: input.confidence ?? 1 })
    .returning();
  return row;
}

export async function updateMemory(userId: string, id: string, patch: { content?: string; kind?: MemoryKind; status?: "approved" | "proposed" }) {
  const db = await getDb();
  const [row] = await db
    .update(schema.memories)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId)))
    .returning();
  if (!row) throw new AppError(404, "not_found", "Memory not found.");
  return row;
}

export async function deleteMemories(userId: string, ids: string[] | "all") {
  const db = await getDb();
  const where = ids === "all" ? eq(schema.memories.userId, userId) : and(eq(schema.memories.userId, userId), inArray(schema.memories.id, ids));
  const rows = await db.delete(schema.memories).where(where).returning({ id: schema.memories.id });
  return rows.length;
}

/** Deletes history older than the user's retention setting (0 = keep forever). */
export async function applyRetention(userId: string, days: number) {
  if (!days) return 0;
  const db = await getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .delete(schema.conversations)
    .where(and(eq(schema.conversations.userId, userId), lt(schema.conversations.updatedAt, cutoff)))
    .returning({ id: schema.conversations.id });
  return rows.length;
}

/** Deterministic "remember that ..." / "forget ..." commands, so explicit requests never depend on the model. */
export function parseMemoryCommand(text: string): { action: "remember"; content: string; kind: MemoryKind } | { action: "forget"; content: string } | null {
  const t = text.trim().replace(/^(hey\s+)?jarvis[,.!]?\s*/i, "");
  let m = t.match(/^(?:please\s+)?(?:remember|note|keep in mind)(?:\s+that)?[:,]?\s+(.{3,})$/i);
  if (m) {
    const content = m[1].replace(/[.!]+$/, "").trim();
    const kind: MemoryKind = /\b(i (?:prefer|like|love|hate|dislike|want)|my favou?rite|call me)\b/i.test(content)
      ? "preference"
      : /\b(project|working on|building|deadline)\b/i.test(content)
        ? "project"
        : "fact";
    return { action: "remember", content: content.charAt(0).toUpperCase() + content.slice(1), kind };
  }
  m = t.match(/^(?:please\s+)?forget(?:\s+(?:that|about))?\s+(.{3,})$/i);
  if (m) return { action: "forget", content: m[1].replace(/[.!]+$/, "").trim() };
  return null;
}
