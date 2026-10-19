import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { getDb, schema } from "@/lib/server/db/client";
import { AppError } from "@/lib/server/errors";
import { json, readBody, route } from "@/lib/server/http";
import { reflect } from "@/lib/server/learning";
import { getSettings } from "@/lib/server/settings";

const body = z.object({
  messageId: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().max(1000).default(""),
  /** Adds the question to the evaluation set (the user approves it as a test example). */
  addToEval: z.boolean().default(false),
  expectedPoints: z.array(z.string().max(300)).max(8).default([]),
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await readBody(req, body);
  const db = await getDb();
  const msg = (await db.select().from(schema.messages).where(and(eq(schema.messages.id, input.messageId), eq(schema.messages.userId, user.id))).limit(1))[0];
  if (!msg || msg.role !== "assistant") throw new AppError(404, "not_found", "Answer not found.");
  await db
    .insert(schema.feedback)
    .values({ userId: user.id, messageId: msg.id, rating: input.rating, comment: input.comment })
    .onConflictDoUpdate({ target: [schema.feedback.messageId, schema.feedback.userId], set: { rating: input.rating, comment: input.comment } });
  if (input.addToEval && typeof msg.meta.question === "string") {
    await db.insert(schema.evalCases).values({
      userId: user.id,
      question: msg.meta.question,
      expectedPoints: input.expectedPoints,
      expectResearch: msg.meta.mode === "research",
      approved: true,
    });
  }
  // A thumbs-down with an explanation is the strongest learning signal: reflect on it now.
  if (input.rating < 0 && input.comment.trim() && (await getSettings(user.id)).selfReflection) {
    void reflect(user.id).catch((e) => console.warn("[jarvis] reflection failed:", (e as Error).message));
  }
  return json({ ok: true });
});
