import { desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/admin";
import { requireUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { getDb, schema } from "@/lib/server/db/client";
import { json, readBody, route } from "@/lib/server/http";
import { activateConfig, listConfigs, rollbackConfig } from "@/lib/server/reasoning/promptConfig";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  const runs = await db.select({ configVersion: schema.evalRuns.configVersion, scores: schema.evalRuns.scores, createdAt: schema.evalRuns.createdAt }).from(schema.evalRuns).orderBy(desc(schema.evalRuns.createdAt)).limit(20);
  void user;
  return json({ configs: await listConfigs(), evalRuns: runs });
});

/** Activate a version or roll back to the previous one (owner only). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  await requireAdmin(user);
  const body = await readBody(req, z.discriminatedUnion("action", [z.object({ action: z.literal("activate"), version: z.string().max(60) }), z.object({ action: z.literal("rollback") })]));
  const version = body.action === "rollback" ? await rollbackConfig() : (await activateConfig(body.version), body.version);
  await audit(user.id, `config:${body.action}`, "ok", { version }, "medium");
  return json({ ok: true, active: version });
});
