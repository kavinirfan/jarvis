import { requireUser } from "@/lib/server/auth";
import { config } from "@/lib/server/config";
import { AppError } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { describeGeminiError, geminiFetch } from "@/lib/server/llm/gemini";
import { rateLimit } from "@/lib/server/rateLimit";
import { assertBudget, recordUsage } from "@/lib/server/usage";

export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = /^audio\/(wav|x-wav|wave|mpeg|mp3|mp4|m4a|x-m4a|aac|ogg|webm|flac|x-flac)$/;

/** Transcribes an uploaded recording, or the post-wake-word clip, with Gemini (non-streaming). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  if (!rateLimit(`stt:${user.id}`, 30, 60_000).ok) throw new AppError(429, "rate_limited", "Too many transcriptions. Wait a moment.");
  await assertBudget(user.id);
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) throw new AppError(400, "bad_request", "Attach an audio file in the 'audio' field.");
  if (file.size > MAX_BYTES) throw new AppError(413, "too_large", "Audio files must be under 15 MB.");
  const type = (file.type || "audio/wav").split(";")[0];
  if (!TYPES.test(type)) throw new AppError(415, "unsupported", `Unsupported audio type ${type}.`);
  const language = String(form?.get("language") ?? "auto");

  if (config().providerMode === "mock" || !config().geminiKey) {
    return json({ text: "[MOCK] transcription unavailable without GEMINI_API_KEY", mock: true });
  }
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const t0 = Date.now();
  const res = await geminiFetch(
    `models/${encodeURIComponent(config().models.transcribe)}:generateContent`,
    {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: type === "audio/x-wav" || type === "audio/wave" ? "audio/wav" : type, data } },
            { text: `Transcribe this audio verbatim${language !== "auto" ? ` (language: ${language})` : ""}. Output only the transcript text. If there is no speech, output nothing.` },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    },
    req.signal,
    55_000,
  );
  if (!res.ok) throw describeGeminiError(res.status, await res.text().catch(() => ""));
  const out = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean; audioTranscription?: { text?: string } }[] } }[] };
  // Dedicated transcription models return `audioTranscription` parts; general models return `text`.
  const text = (out.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.audioTranscription?.text ?? p.text ?? "")
    .join("")
    .trim();
  await recordUsage(user.id, "stt", "gemini", { latencyMs: Date.now() - t0, detail: { bytes: file.size } });
  return json({ text, mock: false });
});
