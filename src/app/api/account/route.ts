import { eq } from "drizzle-orm";
import { z } from "zod";
import { clearedSessionCookie, requireUser, verifyPassword } from "@/lib/server/auth";
import { getDb, schema } from "@/lib/server/db/client";
import { AppError } from "@/lib/server/errors";
import { json, readBody, route } from "@/lib/server/http";

/** Export everything stored about the user. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  const [conversations, messages, memories, notes, tasks, settings] = await Promise.all([
    db.select().from(schema.conversations).where(eq(schema.conversations.userId, user.id)),
    db.select().from(schema.messages).where(eq(schema.messages.userId, user.id)),
    db.select().from(schema.memories).where(eq(schema.memories.userId, user.id)),
    db.select().from(schema.notes).where(eq(schema.notes.userId, user.id)),
    db.select().from(schema.tasks).where(eq(schema.tasks.userId, user.id)),
    db.select().from(schema.settings).where(eq(schema.settings.userId, user.id)),
  ]);
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), account: { email: user.email }, settings: settings[0]?.data ?? null, conversations, messages, memories, notes, tasks }, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="jarvis-export.json"', "cache-control": "no-store" },
  });
});

/** Permanently deletes the account and all its data (requires the password). */
export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const { password } = await readBody(req, z.object({ password: z.string().max(200) }));
  const db = await getDb();
  const row = (await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1))[0];
  if (!row || !(await verifyPassword(password, row.passwordHash))) throw new AppError(401, "bad_credentials", "Wrong password.");
  await db.delete(schema.users).where(eq(schema.users.id, user.id));
  return json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie() } });
});
