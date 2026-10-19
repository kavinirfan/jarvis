import "server-only";
import { asc } from "drizzle-orm";
import type { SessionUser } from "./auth";
import { config } from "./config";
import { getDb, schema } from "./db/client";
import { AppError } from "./errors";

/** The first account (the owner) and JARVIS_ADMIN_EMAILS may change global configuration. */
export async function isAdmin(user: SessionUser): Promise<boolean> {
  if (config().adminEmails.includes(user.email)) return true;
  const db = await getDb();
  const first = (await db.select({ id: schema.users.id }).from(schema.users).orderBy(asc(schema.users.createdAt)).limit(1))[0];
  return first?.id === user.id;
}

export async function requireAdmin(user: SessionUser) {
  if (!(await isAdmin(user))) throw new AppError(403, "forbidden", "Only the owner account can change this.");
}
