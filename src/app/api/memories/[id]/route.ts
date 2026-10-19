import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { AppError } from "@/lib/server/errors";
import { json, readBody, route } from "@/lib/server/http";
import { deleteMemories, MEMORY_KINDS, updateMemory } from "@/lib/server/memory";

type Ctx = { params: Promise<{ id: string }> };
const patch = z.object({ content: z.string().trim().min(2).max(1000).optional(), kind: z.enum(MEMORY_KINDS).optional(), status: z.enum(["approved"]).optional() });
const id = async (ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(404, "not_found", "Memory not found.");
  return id;
};

/** Edit a memory, or approve a proposed one ({status: "approved"}). */
export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const memory = await updateMemory(user.id, await id(ctx), await readBody(req, patch));
  await audit(user.id, "memory:update", "ok", { id: memory.id });
  return json({ memory });
});

export const DELETE = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const n = await deleteMemories(user.id, [await id(ctx)]);
  if (!n) throw new AppError(404, "not_found", "Memory not found.");
  return json({ ok: true });
});
