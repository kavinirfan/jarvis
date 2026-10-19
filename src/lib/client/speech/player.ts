"use client";

/**
 * Speaks answers. Splits text into sentences and synthesizes them one by one (prefetching the
 * next while the current one plays), so speech starts quickly instead of after the whole answer
 * is synthesized. Uses Gemini's natural voice via /api/tts, falling back to the browser's
 * built-in voice. stop() silences everything immediately.
 */

export interface SpeakOptions {
  engine: "gemini" | "browser";
  voice: string;
  rate: number;
  lang: string;
}

export type PlayerState = "idle" | "loading" | "speaking" | "paused";

export function splitForSpeech(text: string, max = 280): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
    // Keep the first chunk short so speech starts fast.
    if (out.length === 0 && cur.length > 60) {
      out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export class SpeechPlayer {
  private audio: HTMLAudioElement | null = null;
  private aborter: AbortController | null = null;
  private generation = 0;
  private state: PlayerState = "idle";
  /** Text currently being spoken, used to recognize JARVIS's own voice in the transcript. */
  currentText = "";
  lastEndedAt = 0;
  /** Which voice actually spoke last (shown in Status). */
  voiceLabel = "";
  /** After a rate-limit/quota error, use the browser voice for a while instead of retrying. */
  private naturalVoiceCooldownUntil = 0;

  constructor(private onState: (s: PlayerState, detail?: string) => void) {}

  private set(s: PlayerState, detail?: string) {
    this.state = s;
    this.onState(s, detail);
  }

  get playerState(): PlayerState {
    return this.state;
  }

  get speaking() {
    return this.state === "speaking" || this.state === "loading" || this.state === "paused";
  }

  async speak(text: string, opts: SpeakOptions): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    const parts = splitForSpeech(text);
    if (!parts.length) return;
    this.currentText = text;
    this.aborter = new AbortController();
    this.set("loading");
    let engine = opts.engine === "gemini" && Date.now() < this.naturalVoiceCooldownUntil ? "browser" : opts.engine;
    let next: Promise<{ blob: Blob; voice: string; rateApplied: boolean } | null> | null = engine === "gemini" ? this.fetchAudio(parts[0], opts.voice, opts.rate) : null;
    try {
      for (let i = 0; i < parts.length; i++) {
        if (gen !== this.generation) return;
        if (engine === "gemini") {
          const got = await next;
          next = i + 1 < parts.length ? this.fetchAudio(parts[i + 1], opts.voice, opts.rate) : null;
          if (gen !== this.generation) return;
          if (got) {
            this.voiceLabel = got.voice;
            await this.playBlob(got.blob, got.rateApplied ? 1 : opts.rate, gen);
            continue;
          }
          engine = "browser"; // natural voice unavailable: fall back for the rest
          this.onState("loading", "Natural voice unavailable; using the browser voice.");
        }
        await this.speakBrowser(parts[i], opts, gen);
      }
    } finally {
      if (gen === this.generation) {
        this.currentText = "";
        this.lastEndedAt = Date.now();
        this.set("idle");
      }
    }
  }

  private async fetchAudio(text: string, voice: string, rate: number): Promise<{ blob: Blob; voice: string; rateApplied: boolean } | null> {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice, rate }),
        signal: this.aborter?.signal,
      });
      if (res.status === 429 || res.status === 503) this.naturalVoiceCooldownUntil = Date.now() + 60_000;
      if (!res.ok) return null;
      return { blob: await res.blob(), voice: res.headers.get("x-jarvis-voice") ?? "", rateApplied: res.headers.get("x-jarvis-rate-applied") === "1" };
    } catch {
      return null;
    }
  }

  private playBlob(blob: Blob, rate: number, gen: number): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = rate;
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      this.audio = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.audio === audio) this.audio = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = () => {
        if (gen !== this.generation) done();
      };
      audio
        .play()
        .then(() => gen === this.generation && this.set("speaking"))
        .catch(() => done());
    });
  }

  private speakBrowser(text: string, opts: SpeakOptions, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === "undefined") return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate;
      u.pitch = 1.05;
      if (opts.lang && opts.lang !== "auto") u.lang = opts.lang;
      const voices = speechSynthesis.getVoices();
      const lang = (u.lang || "en-US").slice(0, 2);
      const sameLang = voices.filter((v) => v.lang.startsWith(lang));
      // Prefer natural-sounding female voices when the browser voice is used.
      const FEMALE = [/Ava \(Premium\)/, /Zoe \(Premium\)/, /Ava/, /Zoe/, /Allison/, /Samantha \(Enhanced\)/, /Google UK English Female/, /Google US English/, /Microsoft (Aria|Jenny|Sonia|Libby)/, /Samantha/, /Serena/, /Karen/, /Moira/, /Tessa/, /female/i];
      const preferred = FEMALE.map((re) => sameLang.find((v) => re.test(v.name))).find(Boolean) ?? sameLang[0];
      if (preferred) u.voice = preferred;
      u.onstart = () => gen === this.generation && this.set("speaking");
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }

  pause() {
    if (this.audio) this.audio.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.pause();
    if (this.speaking) this.set("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    void this.audio?.play();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.resume();
    this.set("speaking");
  }

  /** Stops speaking immediately. */
  stop() {
    const wasActive = this.speaking;
    this.generation++;
    this.aborter?.abort();
    this.aborter = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    if (wasActive) {
      this.currentText = "";
      this.lastEndedAt = Date.now();
      this.set("idle");
    }
  }
}
