/**
 * Recognizes follow-up commands deterministically so they work reliably and cheaply:
 * "explain that again", "go deeper", "give me an example", "summarize the last five minutes".
 */
export type FollowUp =
  | { kind: "rephrase" }
  | { kind: "deeper" }
  | { kind: "example" }
  | { kind: "summarize"; minutes: number };

const NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, "a few": 3, few: 3, couple: 2, "a couple of": 2,
};

export function stripWakePhrase(text: string): string {
  return text.replace(/^\s*(?:(?:hey|hi|okay|ok|yo)[\s,]+)?jarvis\b[\s,.!?:-]*/i, "").trim();
}

export function parseFollowUp(raw: string): FollowUp | null {
  const t = stripWakePhrase(raw).toLowerCase().replace(/[?.!]+$/, "").trim();
  if (!t || t.split(/\s+/).length > 14) return null;
  const sum = t.match(/\b(?:summari[sz]e|recap|sum up)\b.*?\b(?:last|past|previous)\s+(\d+|[a-z ]+?)\s*(?:minutes?|mins?)\b/);
  if (sum) {
    const n = /^\d+$/.test(sum[1]) ? Number(sum[1]) : (NUMBERS[sum[1].trim()] ?? 5);
    return { kind: "summarize", minutes: Math.max(1, Math.min(120, n)) };
  }
  if (/\b(?:summari[sz]e|recap)\b.*\b(?:conversation|discussion|meeting|that)\b/.test(t)) return { kind: "summarize", minutes: 10 };
  if (/^(?:can you |could you |please )?(?:explain|say|put) (?:that|it|this) (?:again|differently|another way|more simply)|^(?:repeat|rephrase) (?:that|it)|^i (?:don't|didn't) (?:get|understand) (?:that|it)/.test(t))
    return { kind: "rephrase" };
  if (/^(?:can you |could you |please )?(?:go|dig|dive) deeper|^(?:tell me )?more (?:detail|details|about (?:that|it))|^elaborate|^tell me more$/.test(t)) return { kind: "deeper" };
  if (/^(?:can you |could you |please )?(?:give me|show me|what's|what is) an? example|^for example$|^example(?: please)?$/.test(t)) return { kind: "example" };
  return null;
}

/** Turns markdown into plain text suitable for speech, and keeps it short. */
export function toSpoken(markdown: string, maxSentences = 3): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/\[(\d+(?:,\s*\d+)*)\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>|]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [plain];
  const out = sentences.slice(0, maxSentences).join("").trim();
  return sentences.length > maxSentences ? `${out} The full answer is on screen.` : out;
}
