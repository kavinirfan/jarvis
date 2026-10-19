import { z } from "zod";
import { requireAdmin } from "@/lib/server/admin";
import { requireUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { runEvaluation } from "@/lib/server/eval/runner";
import { json, readBody, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

export const maxDuration = 300;

/** Runs the evaluation set against a configuration version (owner only; uses real API calls). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  await requireAdmin(user);
  if (!rateLimit(`eval:${user.id}`, 3, 60 * 60_000).ok) throw new AppError(429, "rate_limited", "Evaluations are limited to 3 per hour (each one makes ~20 AI calls).");
  const { version } = await readBody(req, z.object({ version: z.string().max(60).optional() }));
  const result = await runEvaluation({ version });
  await audit(user.id, "eval:run", "ok", { version: result.version, scores: result.scores }, "low");
  return json(result);
});
