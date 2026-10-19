import { z } from "zod";

/** Per-user preferences, synced across devices through the account. */
export const settingsSchema = z.object({
  responseLength: z.enum(["brief", "normal", "detailed"]).default("normal"),
  technicalLevel: z.enum(["simple", "intermediate", "expert"]).default("intermediate"),
  language: z.string().max(20).default("en-US"),
  /** Answer language; "auto" replies in the language of the question. */
  responseLanguage: z.string().max(20).default("auto"),
  voiceEnabled: z.boolean().default(true),
  voiceEngine: z.enum(["gemini", "browser"]).default("gemini"),
  voiceName: z.string().max(40).default("Kore"),
  /** Set once the user picks a voice themselves (older accounts defaulted to a male voice). */
  voicePicked: z.boolean().default(false),
  speechRate: z.number().min(0.5).max(2).default(1),
  /** wake: only act after "Hey JARVIS". ambient: also answer clear questions heard nearby. */
  listenMode: z.enum(["wake", "ambient"]).default("wake"),
  sttEngine: z.enum(["gemini", "browser"]).default("gemini"),
  wakeThreshold: z.number().min(0.2).max(0.95).default(0.5),
  /** Require the transcript to contain "Jarvis" after an acoustic wake detection. */
  strictWakeVerification: z.boolean().default(true),
  silenceTimeoutSec: z.number().min(5).max(600).default(20),
  autoResearch: z.boolean().default(true),
  memoryEnabled: z.boolean().default(true),
  /** Save durable facts the user states automatically (they're shown and can be deleted). */
  autoLearn: z.boolean().default(true),
  /** Periodically reflect on feedback and conversations to refine JARVIS's behavior. */
  selfReflection: z.boolean().default(true),
  /** Desktop app: start listening for "Hey JARVIS" as soon as JARVIS launches. */
  listenOnStartup: z.boolean().default(true),
  /** Allow tools that act on this computer (only when the server runs locally with device tools enabled). */
  deviceAccess: z.boolean().default(true),
  /** Store ambient transcripts (not just questions and answers) in history. */
  saveTranscripts: z.boolean().default(false),
  historyRetentionDays: z.number().int().min(0).max(3650).default(90),
});

export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** Gemini prebuilt voices with their published character. */
export const VOICE_OPTIONS: { name: string; gender: "female" | "male"; style: string }[] = [
  { name: "Kore", gender: "female", style: "firm, clear" },
  { name: "Erinome", gender: "female", style: "clear" },
  { name: "Aoede", gender: "female", style: "breezy" },
  { name: "Leda", gender: "female", style: "youthful" },
  { name: "Zephyr", gender: "female", style: "bright" },
  { name: "Despina", gender: "female", style: "smooth" },
  { name: "Sulafat", gender: "female", style: "warm" },
  { name: "Vindemiatrix", gender: "female", style: "gentle" },
  { name: "Gacrux", gender: "female", style: "mature" },
  { name: "Autonoe", gender: "female", style: "bright" },
  { name: "Charon", gender: "male", style: "informative" },
  { name: "Puck", gender: "male", style: "upbeat" },
  { name: "Fenrir", gender: "male", style: "excitable" },
  { name: "Orus", gender: "male", style: "firm" },
  { name: "Iapetus", gender: "male", style: "clear" },
  { name: "Algenib", gender: "male", style: "gravelly" },
];
export const GEMINI_VOICES = VOICE_OPTIONS.map((v) => v.name);
