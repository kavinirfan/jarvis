import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/server/auth";
import { getDb, schema } from "@/lib/server/db/client";
import { json, route } from "@/lib/server/http";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  const [notes, tasks] = await Promise.all([
    db.select().from(schema.notes).where(eq(schema.notes.userId, user.id)).orderBy(desc(schema.notes.createdAt)).limit(100),
    db.select().from(schema.tasks).where(eq(schema.tasks.userId, user.id)).orderBy(desc(schema.tasks.createdAt)).limit(100),
  ]);
  return json({ notes, tasks });
});
