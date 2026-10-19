import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { config } from "@/lib/server/config";
import { AppError } from "@/lib/server/errors";
import { json, readBody, route } from "@/lib/server/http";
import { describeGeminiError, geminiFetch } from "@/lib/server/llm/gemini";
import { rateLimit } from "@/lib/server/rateLimit";
import { recordUsage } from "@/lib/server/usage";

/**
 * Issues a single-use, short-lived Gemini token for one streaming transcription session
 * (ported from Crackin). The token is locked to the transcription model and config, so even if
 * it leaked it couldn't be used for anything else. The real API key never leaves the server.
 */
const body = z.object({ language: z.string().regex(/^(auto|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/).default("auto") });

export const POST = route(async (req) => {
  const user = await requireUser(req);
  if (!config().geminiKey || config().providerMode === "mock") {
    throw new AppError(503, "missing_key", "Streaming transcription needs GEMINI_API_KEY. Switch Speech engine to Browser in settings, or add the key.");
  }
  if (!rateLimit(`stt-token:${user.id}`, 20, 60_000).ok) throw new AppError(429, "rate_limited", "Too many transcription sessions. Wait a moment.");
  const { language } = await readBody(req, body);
  const model = `models/${config().models.transcribeLive}`;
  const setup = {
    generationConfig: { responseModalities: ["TEXT"] },
    inputAudioTranscription: { languageCodes: language === "auto" ? [] : [language] },
  };
  const now = Date.now();
  const res = await geminiFetch(
    "auth_tokens",
    {
      uses: 1,
      expireTime: new Date(now + 15 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      // With no fieldMask, this setup is enforced and anything the client sends is ignored.
      bidiGenerateContentSetup: { model, ...setup },
    },
    undefined,
    15_000,
  );
  if (!res.ok) throw describeGeminiError(res.status, await res.text().catch(() => ""));
  const data = (await res.json()) as { name?: string };
  if (!data.name) throw new AppError(502, "upstream_error", "Gemini didn't return a session token.");
  await recordUsage(user.id, "stt", "gemini-live");
  return json({ token: data.name, model, config: setup });
});
