import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { json, readBody, route } from "@/lib/server/http";
import { createMemory, deleteMemories, listMemories, memoryInput } from "@/lib/server/memory";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const p = new URL(req.url).searchParams;
  const status = p.get("status");
  return json({ memories: await listMemories(user.id, { status: status === "proposed" || status === "approved" ? status : undefined, q: p.get("q")?.slice(0, 200) || undefined }) });
});

/** Manually adding a memory counts as approving it. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await readBody(req, memoryInput);
  const memory = await createMemory(user.id, { ...input, status: "approved", source: "user" });
  await audit(user.id, "memory:create", "ok", { id: memory.id });
  return json({ memory });
});

export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const { ids } = await readBody(req, z.object({ ids: z.union([z.literal("all"), z.array(z.string().uuid()).max(500)]) }));
  const deleted = await deleteMemories(user.id, ids);
  await audit(user.id, "memory:delete", "ok", { count: deleted, all: ids === "all" }, ids === "all" ? "medium" : "low");
  return json({ deleted });
});
