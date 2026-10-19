import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/server/auth";
import { getDb, schema } from "@/lib/server/db/client";
import { AppError } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { conversationMessages } from "@/lib/server/reasoning/engine";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

export const GET = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new AppError(404, "not_found", "Conversation not found.");
  const db = await getDb();
  const conv = (await db.select().from(schema.conversations).where(and(eq(schema.conversations.id, id), eq(schema.conversations.userId, user.id))).limit(1))[0];
  if (!conv) throw new AppError(404, "not_found", "Conversation not found.");
  return json({ conversation: conv, messages: await conversationMessages(user.id, id) });
});

export const DELETE = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new AppError(404, "not_found", "Conversation not found.");
  const db = await getDb();
  const rows = await db.delete(schema.conversations).where(and(eq(schema.conversations.id, id), eq(schema.conversations.userId, user.id))).returning({ id: schema.conversations.id });
  if (!rows.length) throw new AppError(404, "not_found", "Conversation not found.");
  return json({ ok: true });
});
