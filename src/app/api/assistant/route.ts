import { z } from "zod";
import type { AssistantEvent } from "@/lib/shared/events";
import { requireUser } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { readBody, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { runAssistant } from "@/lib/server/reasoning/engine";
import { deviceToolsAllowed } from "@/lib/server/device/access";
import { assertBudget } from "@/lib/server/usage";

export const maxDuration = 60;

const body = z.object({
  text: z.string().trim().min(1).max(4000),
  trigger: z.enum(["wake", "ambient", "typed", "upload"]),
  conversationId: z.string().uuid().optional(),
  transcript: z
    .array(z.object({ at: z.string().max(40), text: z.string().max(2000), source: z.enum(["mic", "system", "typed", "upload"]).optional() }))
    .max(400)
    .optional(),
  force: z.enum(["research", "direct"]).optional(),
});

/** Runs one assistant turn and streams progress + the answer as NDJSON events. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await readBody(req, body, 400_000);
  if (!rateLimit(`assistant:${user.id}`, 30, 60_000).ok) throw new AppError(429, "rate_limited", "That's a lot of requests. Give it a few seconds.");
  await assertBudget(user.id);

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AssistantEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // Client went away.
        }
      };
      try {
        await runAssistant(user.id, input, emit, abort.signal, { device: deviceToolsAllowed(req) });
      } catch (e) {
        if (!abort.signal.aborted) {
          const err = e instanceof AppError ? e : null;
          if (!err) console.error("[jarvis] assistant error:", (e as Error)?.message);
          emit({ type: "error", code: err?.code ?? "internal", message: err?.message ?? "Something went wrong while answering." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
