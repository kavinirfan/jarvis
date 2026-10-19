import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { deviceToolsAllowed } from "@/lib/server/device/access";
import { getSettings } from "@/lib/server/settings";
import { AppError } from "@/lib/server/errors";
import { json, readBody, route } from "@/lib/server/http";
import { resolvePendingAction } from "@/lib/server/tools/registry";

type Ctx = { params: Promise<{ id: string }> };

/** Approve or cancel an action JARVIS asked to confirm. */
export const POST = route(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(404, "not_found", "Action not found.");
  const { approve } = await readBody(req, z.object({ approve: z.boolean() }));
  const device = deviceToolsAllowed(req) && (await getSettings(user.id)).deviceAccess;
  const result = await resolvePendingAction({ userId: user.id, device }, id, approve);
  return json({ ok: true, result });
});
