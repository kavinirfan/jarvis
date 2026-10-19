/**
 * Detects when someone nearby has finished asking a question (ambient mode).
 * Ported from Crackin's call assistant.
 *
 * Finalized transcript segments are buffered; once the speaker has been quiet for
 * `quietMs`, the buffered speech is checked. If it reads like a question (or a
 * request such as "Tell me about…"), `onQuestion` fires with the text. This cheap
 * local filter runs before any AI call, so ordinary chatter costs nothing.
 * Time is passed in explicitly, so the logic is deterministic and testable.
 */

const QUESTION_STARTS = [
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "which",
  "whose",
  "can you",
  "could you",
  "would you",
  "will you",
  "do you",
  "did you",
  "does",
  "have you",
  "has",
  "are you",
  "were you",
  "is there",
  "is it",
  "is that",
  "should",
  "tell me",
  "tell us",
  "walk me",
  "walk us",
  "talk me",
  "describe",
  "explain",
  "give me",
  "give us",
  "share",
  "talk about",
  "talk to me about",
  "i'd like to hear",
  "i would like to hear",
  "i want to hear",
  "i'm curious",
  "imagine",
  "suppose",
  "is",
  "are",
  "was",
  "were",
  "can",
  "could",
];

const QUESTION_PHRASES = [
  "tell me about",
  "walk me through",
  "how would you",
  "what would you",
  "how do you",
  "what do you",
  "why did you",
  "can you explain",
  "could you explain",
  "an example of",
  "i wonder",
  "i wonder if",
  "does anyone know",
  "anyone know",
  "look up",
  "find out",
];

const LEADING_FILLER = /^(?:(?:so|okay|ok|alright|all right|right|great|cool|and|but|well|now|next|um|uh|perfect|thanks|thank you)[\s,.!]+)+/;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function startsLikeQuestion(sentence: string): boolean {
  const s = normalize(sentence).replace(LEADING_FILLER, "");
  return QUESTION_STARTS.some((p) => s === p || s.startsWith(`${p} `) || s.startsWith(`${p},`) || s.startsWith(`${p}'`));
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function isLikelyQuestion(text: string, minWords = 3): boolean {
  const t = text.trim();
  if (wordCount(t) < minWords) return false;
  const lower = normalize(t);
  if (lower.endsWith("?")) return true;
  const parts = sentences(t);
  const last = parts[parts.length - 1] ?? t;
  if (/\?\s*$/.test(last)) return true;
  if (parts.some((s) => s.includes("?"))) return true;
  if (startsLikeQuestion(last) || startsLikeQuestion(t)) return true;
  return QUESTION_PHRASES.some((p) => lower.includes(p));
}

export interface DetectorOptions {
  /** Silence after the last segment before deciding, in ms. */
  quietMs?: number;
  /**
   * Shorter wait when the last segment already ends with "?". The speech engine only
   * finalizes a segment after a pause, so a clear question needs little extra waiting.
   */
  questionQuietMs?: number;
  minWords?: number;
  onQuestion: (question: string) => void;
}

export class QuestionDetector {
  private buffer: string[] = [];
  private lastAt = 0;
  private readonly quietMs: number;
  private readonly questionQuietMs: number;
  private readonly minWords: number;
  private readonly opts: DetectorOptions;

  constructor(opts: DetectorOptions) {
    this.opts = opts;
    this.quietMs = opts.quietMs ?? 900;
    this.questionQuietMs = opts.questionQuietMs ?? 150;
    this.minWords = opts.minWords ?? 3;
  }

  /** Adds a finalized segment from the person asking questions. */
  push(text: string, now: number) {
    const t = text.trim();
    if (!t) return;
    this.buffer.push(t);
    this.lastAt = now;
  }

  /** Marks that the speaker is still talking (an interim result arrived), delaying the decision. */
  touch(now: number) {
    if (this.buffer.length) this.lastAt = now;
  }

  /** Call regularly (e.g. every 200 ms). Returns the detected question, if any. */
  tick(now: number): string | null {
    if (!this.buffer.length) return null;
    const endsWithQuestion = /\?\s*$/.test(this.buffer[this.buffer.length - 1]);
    if (now - this.lastAt < (endsWithQuestion ? this.questionQuietMs : this.quietMs)) return null;
    const text = this.buffer.join(" ");
    this.buffer = [];
    if (!isLikelyQuestion(text, this.minWords)) return null;
    this.opts.onQuestion(text);
    return text;
  }

  reset() {
    this.buffer = [];
  }
}
