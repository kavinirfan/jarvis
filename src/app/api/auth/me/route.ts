import { count } from "drizzle-orm";
import { isAdmin } from "@/lib/server/admin";
import { getSessionUser } from "@/lib/server/auth";
import { config } from "@/lib/server/config";
import { getDb, schema } from "@/lib/server/db/client";
import { json, route } from "@/lib/server/http";

export const GET = route(async (req) => {
  const user = await getSessionUser(req);
  if (!user) {
    const db = await getDb();
    const [{ n }] = await db.select({ n: count() }).from(schema.users);
    return json({ user: null, canRegister: Number(n) === 0 || config().allowRegistration, firstRun: Number(n) === 0 });
  }
  return json({ user: { id: user.id, email: user.email, displayName: user.displayName, admin: await isAdmin(user) } });
});
