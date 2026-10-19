"use client";

import type { TranscriberCallbacks } from "./geminiTranscriber";

/**
 * Fallback engine: the browser's built-in Web Speech recognition (ported from Crackin).
 * Free and needs no key, but it can only listen to the default microphone
 * (not tab or system audio). Chrome sends the audio to Google; Safari to Apple.
 */

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: RecognitionResultLike } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function browserRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export class BrowserMicTranscriber {
  private rec: RecognitionLike | null = null;
  private wanted = false;

  constructor(
    private language: string,
    private cb: TranscriberCallbacks,
  ) {}

  start() {
    const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      this.cb.onStatus("error", "This browser has no built-in speech recognition. Use Chrome or Safari, or the Gemini engine.");
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.language === "auto" ? navigator.language || "en-US" : this.language;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) this.cb.onFinal(text);
        } else {
          interim += r[0].transcript;
        }
      }
      this.cb.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.wanted = false;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was blocked for speech recognition.",
        "audio-capture": "No microphone was found.",
        network: "Browser speech recognition needs an internet connection.",
      };
      this.cb.onStatus("error", messages[e.error] ?? `Speech recognition error: ${e.error}`);
    };
    rec.onend = () => {
      // Browsers stop after a pause; restart while the call is running.
      if (this.wanted && this.rec === rec) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through */
        }
      }
      this.cb.onInterim("");
    };
    this.rec = rec;
    this.wanted = true;
    try {
      rec.start();
      this.cb.onStatus("live");
    } catch {
      this.cb.onStatus("error", "Couldn't start browser speech recognition.");
    }
  }

  stop() {
    this.wanted = false;
    this.rec?.stop();
    this.rec = null;
    this.cb.onStatus("stopped");
  }
}
