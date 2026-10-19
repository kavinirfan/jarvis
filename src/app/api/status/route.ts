import { isAdmin } from "@/lib/server/admin";
import { requireUser } from "@/lib/server/auth";
import { config, configIssues } from "@/lib/server/config";
import { json, route } from "@/lib/server/http";
import { getActiveConfig } from "@/lib/server/reasoning/promptConfig";
import { searchChain } from "@/lib/server/search";
import { recentFailures, usageToday } from "@/lib/server/usage";

/** Which services are configured (never the keys themselves), usage, and recent failures. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const c = config();
  const mock = c.providerMode === "mock" || !c.geminiKey;
  return json({
    services: {
      ai: mock ? "mock" : "gemini",
      models: mock ? null : { fast: c.models.fast, balanced: c.models.balanced },
      search: searchChain().map((p) => p.id),
      stt: mock ? ["browser"] : ["gemini-live", "browser", "upload"],
      tts: mock ? ["browser"] : ["gemini", "browser"],
      wakeWord: "openWakeWord (on-device)",
      database: c.databaseUrl ? "postgres" : "pglite",
    },
    issues: configIssues(),
    usage: await usageToday(user.id),
    failures: (await recentFailures(user.id, 10)).map((f) => ({ kind: f.kind, provider: f.provider, detail: f.detail, at: f.createdAt })),
    config: (await getActiveConfig()).version,
    admin: await isAdmin(user),
  });
});
