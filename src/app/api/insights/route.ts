import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { getDb, schema } from "@/lib/server/db/client";
import { AppError } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { activeInsights, reflect } from "@/lib/server/learning";
import { rateLimit } from "@/lib/server/rateLimit";
import { assertBudget } from "@/lib/server/usage";

/** What JARVIS has learned about working with the user (profile + behaviors). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return json({ insights: await activeInsights(user.id) });
});

/** Reflect now: rewrite learned behaviors from feedback, conversations and memories. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  if (!rateLimit(`reflect:${user.id}`, 6, 60 * 60_000).ok) throw new AppError(429, "rate_limited", "Reflection is limited to 6 times per hour.");
  await assertBudget(user.id);
  const result = await reflect(user.id);
  if (!result) throw new AppError(503, "unavailable", "Reflection needs a real AI provider (GEMINI_API_KEY).");
  await audit(user.id, "learning:reflect", "ok", { generation: result.generation });
  return json({ result, insights: await activeInsights(user.id) });
});

/** Forget everything JARVIS has learned about how to behave (memories are separate). */
export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  const id = new URL(req.url).searchParams.get("id");
  if (id) await db.delete(schema.insights).where(and(eq(schema.insights.userId, user.id), eq(schema.insights.id, id)));
  else await db.delete(schema.insights).where(eq(schema.insights.userId, user.id));
  await audit(user.id, "learning:reset", "ok", { id: id ?? "all" }, "medium");
  return json({ ok: true });
});
