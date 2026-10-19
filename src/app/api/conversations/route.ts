import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/server/auth";
import { getDb, schema } from "@/lib/server/db/client";
import { json, route } from "@/lib/server/http";
import { applyRetention } from "@/lib/server/memory";
import { getSettings } from "@/lib/server/settings";

/** Lists conversations, newest first. `?q=` searches message text across all history. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  await applyRetention(user.id, (await getSettings(user.id)).historyRetentionDays);
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 200);
  if (q) {
    const hits = await db
      .select({ conversationId: schema.messages.conversationId, content: schema.messages.content, role: schema.messages.role, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(and(eq(schema.messages.userId, user.id), ilike(schema.messages.content, `%${q.replace(/[%_\\]/g, "\\$&")}%`)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(50);
    const ids = [...new Set(hits.map((h) => h.conversationId))];
    const convs = ids.length ? await db.select().from(schema.conversations).where(inArray(schema.conversations.id, ids)) : [];
    return json({ conversations: convs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()), hits: hits.map((h) => ({ ...h, content: h.content.slice(0, 240) })) });
  }
  const rows = await db.select().from(schema.conversations).where(eq(schema.conversations.userId, user.id)).orderBy(desc(schema.conversations.updatedAt)).limit(100);
  return json({ conversations: rows });
});

export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  const rows = await db.delete(schema.conversations).where(eq(schema.conversations.userId, user.id)).returning({ id: schema.conversations.id });
  return json({ deleted: rows.length });
});
