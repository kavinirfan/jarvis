/**
 * Speech activity detection and segmentation. Pure logic with explicit timestamps, so it is
 * deterministic and unit-tested; the browser feeds it the RMS level of each 100 ms chunk.
 */

export interface VadOptions {
  /** Speech must be this many times louder than the noise floor. */
  ratio?: number;
  /** Absolute minimum RMS treated as speech (0..1). */
  minLevel?: number;
  /** Consecutive loud chunks needed to start speech (debounce). */
  startChunks?: number;
}

/** Energy VAD with an adaptive noise floor. */
export class EnergyVad {
  private floor = 0.004;
  private loud = 0;
  speaking = false;
  private readonly ratio: number;
  private readonly minLevel: number;
  private readonly startChunks: number;

  constructor(opts: VadOptions = {}) {
    this.ratio = opts.ratio ?? 2.6;
    this.minLevel = opts.minLevel ?? 0.012;
    this.startChunks = opts.startChunks ?? 2;
  }

  /** Returns true if this chunk contains speech. */
  push(level: number): boolean {
    const threshold = Math.max(this.minLevel, this.floor * this.ratio);
    const isLoud = level > threshold;
    // Track the noise floor slowly upward, quickly downward, and only while quiet.
    if (!isLoud) this.floor = level < this.floor ? this.floor * 0.7 + level * 0.3 : this.floor * 0.97 + level * 0.03;
    this.loud = isLoud ? this.loud + 1 : 0;
    if (!this.speaking && this.loud >= this.startChunks) this.speaking = true;
    if (this.speaking && !isLoud) this.speaking = this.loud > 0;
    return isLoud;
  }

  get noiseFloor() {
    return this.floor;
  }
}

/** Keeps the most recent N ms of audio so the start of a phrase is never cut off. */
export class RingBuffer {
  private chunks: Int16Array[] = [];
  private samples = 0;
  constructor(private maxSamples: number) {}

  push(c: Int16Array) {
    this.chunks.push(c);
    this.samples += c.length;
    while (this.samples - this.chunks[0].length >= this.maxSamples) this.samples -= this.chunks.shift()!.length;
  }

  drain(): Int16Array[] {
    const out = this.chunks;
    this.chunks = [];
    this.samples = 0;
    return out;
  }

  clear() {
    this.chunks = [];
    this.samples = 0;
  }
}

export type RecorderResult = { kind: "speech"; chunks: Int16Array[]; durationMs: number } | { kind: "no_speech" } | { kind: "too_long"; chunks: Int16Array[]; durationMs: number };

export interface CommandRecorderOptions {
  /** Give up if no speech starts within this time after the wake word. */
  noSpeechTimeoutMs?: number;
  /** Speech ends after this much silence. */
  endSilenceMs?: number;
  /** Hard cap on a command's length. */
  maxMs?: number;
}

/**
 * Records the command spoken after "Hey JARVIS": starts with the pre-roll (which contains the
 * wake phrase itself, used for verification), ends after a pause, or gives up on silence.
 */
export class CommandRecorder {
  private chunks: Int16Array[] = [];
  private startedAt: number;
  private lastSpeechAt: number | null = null;
  private heardSpeech = false;
  private readonly noSpeechTimeoutMs: number;
  private readonly endSilenceMs: number;
  private readonly maxMs: number;

  constructor(preRoll: Int16Array[], now: number, opts: CommandRecorderOptions = {}) {
    this.chunks = [...preRoll];
    this.startedAt = now;
    this.noSpeechTimeoutMs = opts.noSpeechTimeoutMs ?? 5000;
    this.endSilenceMs = opts.endSilenceMs ?? 1300;
    this.maxMs = opts.maxMs ?? 15000;
  }

  /** Feeds a chunk; returns a result when the command is complete. */
  push(chunk: Int16Array, isSpeech: boolean, now: number): RecorderResult | null {
    this.chunks.push(chunk);
    if (isSpeech) {
      this.heardSpeech = true;
      this.lastSpeechAt = now;
    }
    const elapsed = now - this.startedAt;
    if (!this.heardSpeech && elapsed >= this.noSpeechTimeoutMs) return { kind: "no_speech" };
    if (this.heardSpeech && this.lastSpeechAt !== null && now - this.lastSpeechAt >= this.endSilenceMs) {
      return { kind: "speech", chunks: this.chunks, durationMs: elapsed };
    }
    if (elapsed >= this.maxMs) return { kind: "too_long", chunks: this.chunks, durationMs: elapsed };
    return null;
  }
}

/** Accepts common transcriptions of "Jarvis". Rejects near-misses like "Travis" or "Harvest". */
export function containsWakeName(transcript: string): boolean {
  return /\b(jarvis|jarvi|jarves|jarviss|jervis|javis|jarvas|jarbis|charvis)\b/i.test(transcript);
}

/** Similarity used to drop transcripts of JARVIS's own voice (feedback-loop guard). */
export function overlapRatio(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []);
  const wa = words(a);
  const wb = words(b);
  if (!wa.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / wa.size;
}
