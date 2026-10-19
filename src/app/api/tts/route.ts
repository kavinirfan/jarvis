import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { TtsCache } from "@/lib/server/ttsCache";
import { config } from "@/lib/server/config";
import { AppError } from "@/lib/server/errors";
import { readBody, route } from "@/lib/server/http";
import { geminiFetch } from "@/lib/server/llm/gemini";
import { rateLimit } from "@/lib/server/rateLimit";
import { assertBudget, recordUsage } from "@/lib/server/usage";
import { VOICE_OPTIONS } from "@/lib/shared/settings";

const run = promisify(execFile);
const body = z.object({ text: z.string().trim().min(1).max(1200), voice: z.string().max(40).default("Kore"), rate: z.number().min(0.5).max(2).default(1) });
const cache = new TtsCache();

/** Gemini TTS models in order of preference. Each has its own free-tier quota. */
const TTS_MODELS = () => [...new Set([config().models.tts, "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-3.8-flash-lite-tts"])];
const exhausted = new Map<string, number>();

/** Wraps raw 16-bit PCM in a WAV header (some TTS responses are bare PCM). */
function pcmToWav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function geminiVoice(text: string, voiceName: string, signal: AbortSignal): Promise<{ audio: Buffer; type: string; voice: string } | null> {
  for (const model of TTS_MODELS()) {
    if ((exhausted.get(model) ?? 0) > Date.now()) continue;
    const res = await geminiFetch(
      `models/${encodeURIComponent(model)}:generateContent`,
      {
        contents: [{ role: "user", parts: [{ text: `Say this in a clear, warm, confident voice at a natural conversational pace, with crisp articulation:\n${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
      },
      signal,
      30_000,
    ).catch(() => null);
    if (!res) continue;
    if (res.status === 429 || res.status === 404) {
      exhausted.set(model, Date.now() + (res.status === 429 ? 10 * 60_000 : 24 * 3_600_000));
      continue;
    }
    if (!res.ok) continue;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[] };
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!part) continue;
    let audio: Buffer = Buffer.from(part.data, "base64");
    let type = part.mimeType.split(";")[0];
    if (/^audio\/(l16|pcm)/i.test(part.mimeType)) {
      audio = pcmToWav(audio, Number(part.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000));
      type = "audio/wav";
    }
    return { audio, type, voice: `${voiceName} (${model})` };
  }
  return null;
}

/** Best installed female macOS voice; Premium/Enhanced voices sound far more natural. */
let macVoice: Promise<string | null> | null = null;
function bestMacVoice(): Promise<string | null> {
  macVoice ??= run("say", ["-v", "?"])
    .then(({ stdout }) => {
      const names = stdout.split("\n").map((l) => l.split(/\s{2,}/)[0].trim()).filter(Boolean);
      const prefs = [/^Ava \(Premium\)/, /^Zoe \(Premium\)/, /^Allison \(Premium\)/, /^Ava \(Enhanced\)/, /^Zoe \(Enhanced\)/, /^Samantha \(Enhanced\)/, /^Allison \(Enhanced\)/, /^Serena/, /^Samantha$/, /^Karen$/, /^Moira$/];
      for (const p of prefs) {
        const hit = names.find((n) => p.test(n));
        if (hit) return hit;
      }
      return null;
    })
    .catch(() => null);
  return macVoice;
}

/** Local macOS speech (free, offline, no quota) used when the natural voice is unavailable. */
async function macSay(text: string, rate: number): Promise<{ audio: Buffer; type: string; voice: string } | null> {
  if (process.platform !== "darwin") return null;
  const voice = await bestMacVoice();
  if (!voice) return null;
  const dir = await mkdtemp(join(tmpdir(), "jarvis-tts-"));
  try {
    const aiff = join(dir, "s.aiff");
    const wav = join(dir, "s.wav");
    // Text goes in as an argument (no shell), so it can't be interpreted as a command.
    await run("say", ["-v", voice, "-r", String(Math.round(185 * rate)), "-o", aiff, "--", text], { timeout: 20_000 });
    await run("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", aiff, wav], { timeout: 20_000 });
    return { audio: await readFile(wav), type: "audio/wav", voice: `${voice} (macOS)` };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Natural voice: Gemini TTS across several models, then the Mac's own voice, then the browser's. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const { text, voice, rate } = await readBody(req, body);
  const voiceName = VOICE_OPTIONS.some((v) => v.name === voice) ? voice : "Kore";
  const key = createHash("sha256").update(`${voiceName}|${rate}|${text}`).digest("hex");
  let hit = cache.get(key);
  if (!hit) {
    if (!rateLimit(`tts:${user.id}`, 90, 60_000).ok) throw new AppError(429, "rate_limited", "Too many speech requests.");
    const t0 = Date.now();
    if (config().geminiKey && config().providerMode !== "mock") {
      await assertBudget(user.id);
      hit = (await geminiVoice(text, voiceName, req.signal)) ?? undefined;
    }
    hit ??= (await macSay(text, rate)) ?? undefined;
    if (!hit) throw new AppError(503, "voice_unavailable", "Natural voice is unavailable right now; using the browser voice.");
    cache.set(key, hit);
    await recordUsage(user.id, "tts", hit.voice.includes("macOS") ? "macos" : "gemini", { latencyMs: Date.now() - t0, detail: { chars: text.length, voice: hit.voice } });
  }
  return new Response(new Uint8Array(hit.audio), {
    headers: { "content-type": hit.type, "cache-control": "private, max-age=3600", "x-jarvis-voice": hit.voice, "x-jarvis-rate-applied": hit.voice.includes("macOS") ? "1" : "0" },
  });
});
