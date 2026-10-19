import { requireUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { json, readBody, route } from "@/lib/server/http";
import { getSettings, saveSettings } from "@/lib/server/settings";
import { settingsSchema } from "@/lib/shared/settings";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return json({ settings: await getSettings(user.id) });
});

export const PUT = route(async (req) => {
  const user = await requireUser(req);
  const patch = await readBody(req, settingsSchema.partial());
  const settings = await saveSettings(user.id, patch);
  const sensitive = ["memoryEnabled", "saveTranscripts", "historyRetentionDays"].filter((k) => k in patch);
  if (sensitive.length) await audit(user.id, "settings:privacy", "ok", { changed: sensitive }, "medium");
  return json({ settings });
});
