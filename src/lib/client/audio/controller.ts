"use client";

import { CommandRecorder, EnergyVad, RingBuffer, type RecorderResult } from "@/lib/shared/vad";
import type { OpenWakeWord } from "@/lib/shared/wakeword/openWakeWord";
import { BrowserMicTranscriber } from "./browserTranscriber";
import { captureMic, captureSystemAudio, startPcmPipeline, type PcmPipeline } from "./capture";
import { GeminiLiveTranscriber, type TranscriberStatus } from "./geminiTranscriber";
import { createWakeWordDetector } from "./wakeword";

/**
 * Owns everything that touches audio. Two modes:
 *
 *  wake    — audio stays on this device. A local model listens for "Hey JARVIS"; only the
 *            command spoken after it (plus 1.5 s of pre-roll used to double-check the wake word)
 *            is sent for transcription.
 *  ambient — continuous streaming transcription of what the microphone hears, so JARVIS can
 *            pick up questions asked nearby. Streaming pauses after a configurable silence
 *            (power saving) and resumes when speech returns.
 *
 * stop() ends every track, closes the audio graph and transcription sockets, and clears buffers.
 */

export type ListenMode = "wake" | "ambient";
export type CaptureStatus = "off" | "starting" | "on" | "standby" | "reconnecting" | "error";

export interface ControllerOptions {
  mode: ListenMode;
  sttEngine: "gemini" | "browser";
  language: string;
  deviceId?: string;
  wakeThreshold: number;
  silenceTimeoutSec: number;
}

export interface ControllerCallbacks {
  onStatus(status: CaptureStatus, detail?: string): void;
  onLevel(level: number): void;
  /** Local wake-word detection fired. */
  onWake(score: number): void;
  /** Command audio after the wake word (wake mode, Gemini engine). */
  onCommandAudio(chunks: Int16Array[], durationMs: number): void;
  /** Command text after the wake word (browser engine). */
  onCommandText(text: string): void;
  onCommandTimeout(): void;
  onInterim(text: string, source: "mic" | "system"): void;
  onFinal(text: string, source: "mic" | "system"): void;
  onTranscriberStatus(status: TranscriberStatus, detail?: string): void;
  onWakeEngine(state: "loading" | "ready" | "unavailable", detail?: string): void;
  onSystemAudio(active: boolean, detail?: string): void;
}

const CHUNK_MS = 100;
const PRE_ROLL_SAMPLES = 16000 * 1.5;

type Transcriber = { start(): unknown; stop(): void; sendAudio?(pcm: ArrayBuffer): void };

export class ListeningController {
  private opts: ControllerOptions | null = null;
  private stream: MediaStream | null = null;
  private pipeline: PcmPipeline | null = null;
  private wake: OpenWakeWord | null = null;
  private vad = new EnergyVad();
  private ring = new RingBuffer(PRE_ROLL_SAMPLES);
  private recorder: CommandRecorder | null = null;
  private browserCommand: BrowserMicTranscriber | null = null;
  private transcriber: Transcriber | null = null;
  private transcriberPaused = false;
  private lastSpeechAt = 0;
  private clock = 0; // ms of audio processed, used as the recorder's clock
  private running = false;
  private restarts = 0;
  private systemStream: MediaStream | null = null;
  private systemPipeline: PcmPipeline | null = null;
  private systemTranscriber: GeminiLiveTranscriber | null = null;
  /** While JARVIS speaks, raise the wake threshold slightly to resist its own voice. */
  suppressed = false;

  constructor(private cb: ControllerCallbacks) {}

  get active(): boolean {
    return this.running;
  }

  /** True if any capture track is still live. Used by the UI and tests to verify capture stopped. */
  captureLive(): boolean {
    const live = (s: MediaStream | null) => !!s && s.getTracks().some((t) => t.readyState === "live");
    return live(this.stream) || live(this.systemStream);
  }

  async start(opts: ControllerOptions) {
    if (this.running) await this.stop();
    this.opts = opts;
    this.running = true;
    this.restarts = 0;
    this.cb.onStatus("starting");
    try {
      await this.openMic();
    } catch (e) {
      this.running = false;
      await this.teardownMic();
      this.cb.onStatus("error", (e as Error).message);
      throw e;
    }
    // Wake word model loads in parallel with listening; ambient mode works without it.
    this.cb.onWakeEngine("loading");
    createWakeWordDetector(opts.wakeThreshold)
      .then((w) => {
        if (!this.running) return;
        this.wake = w;
        this.cb.onWakeEngine("ready");
      })
      .catch((e) => {
        this.cb.onWakeEngine("unavailable", `On-device wake word couldn't load (${(e as Error).message}).`);
        if (opts.mode === "wake") {
          this.cb.onStatus("error", "Wake-word detection couldn't start on this device. Switch to Ambient mode or type your question.");
        }
      });
    if (opts.mode === "ambient") this.startTranscriber();
    this.cb.onStatus("on");
  }

  private async openMic() {
    const opts = this.opts!;
    this.stream = await captureMic(opts.deviceId);
    const track = this.stream.getAudioTracks()[0];
    track.onended = () => void this.recoverMic();
    this.pipeline = await startPcmPipeline(track, (pcm, level) => this.onMicChunk(pcm, level));
  }

  /** Recovers from an unplugged / reset microphone. */
  private async recoverMic() {
    if (!this.running) return;
    if (this.restarts >= 3) {
      this.cb.onStatus("error", "The microphone disconnected and couldn't be reopened. Check the device and press Enable Listening.");
      await this.stop();
      return;
    }
    this.restarts++;
    this.cb.onStatus("reconnecting", "Microphone disconnected; reconnecting…");
    await this.teardownMic();
    await new Promise((r) => setTimeout(r, 500 * this.restarts));
    try {
      if (this.opts) this.opts = { ...this.opts, deviceId: this.restarts > 1 ? undefined : this.opts.deviceId };
      await this.openMic();
      this.cb.onStatus("on");
    } catch {
      void this.recoverMic();
    }
  }

  private startTranscriber() {
    const opts = this.opts!;
    const cbs = {
      onInterim: (t: string) => this.cb.onInterim(t, "mic"),
      onFinal: (t: string) => this.cb.onFinal(t, "mic"),
      onStatus: (s: TranscriberStatus, d?: string) => this.cb.onTranscriberStatus(s, d),
    };
    this.transcriber = opts.sttEngine === "browser" ? new BrowserMicTranscriber(opts.language, cbs) : new GeminiLiveTranscriber(opts.language, cbs);
    this.transcriberPaused = false;
    this.lastSpeechAt = this.clock;
    void this.transcriber.start();
  }

  private onMicChunk(pcm: Int16Array, level: number) {
    if (!this.running) return;
    this.clock += CHUNK_MS;
    this.cb.onLevel(level);
    const isSpeech = this.vad.push(level);
    if (isSpeech) this.lastSpeechAt = this.clock;
    const opts = this.opts!;

    // Ambient streaming, with power saving after silence.
    if (opts.mode === "ambient" && this.transcriber) {
      const idleMs = this.clock - this.lastSpeechAt;
      if (!this.transcriberPaused && idleMs > opts.silenceTimeoutSec * 1000 && opts.sttEngine === "gemini") {
        this.transcriber.stop();
        this.transcriberPaused = true;
        this.cb.onStatus("standby", `No speech for ${opts.silenceTimeoutSec} s — streaming paused to save power. It resumes when someone speaks.`);
      } else if (this.transcriberPaused && isSpeech) {
        const preRoll = this.ring.drain();
        this.startTranscriber();
        for (const c of preRoll) this.transcriber.sendAudio?.(c.slice().buffer);
        this.cb.onStatus("on");
      }
      if (!this.transcriberPaused) this.transcriber.sendAudio?.(pcm.slice().buffer);
    }

    // Command capture after the wake word.
    if (this.recorder) {
      const res = this.recorder.push(pcm, isSpeech, this.clock);
      if (res) this.finishCommand(res);
    } else {
      this.ring.push(pcm);
    }

    // Local wake-word detection.
    if (this.wake && !this.recorder && !this.browserCommand) {
      const wake = this.wake;
      void wake.process(pcm).then(({ detected, scores }) => {
        if (!detected || !this.running || this.recorder) return;
        const score = Math.max(...scores);
        if (this.suppressed && score < Math.min(0.95, opts.wakeThreshold + 0.25)) return;
        this.beginCommand(score);
      });
    }
  }

  private beginCommand(score: number) {
    const opts = this.opts!;
    this.cb.onWake(score);
    if (opts.mode === "ambient") return; // the live transcript carries the command
    if (opts.sttEngine === "browser") {
      this.ring.clear();
      let finalText = "";
      const t = new BrowserMicTranscriber(opts.language, {
        onInterim: (x) => this.cb.onInterim(x, "mic"),
        onFinal: (x) => {
          finalText += ` ${x}`;
          t.stop();
        },
        onStatus: (s, d) => {
          if (s === "error") this.cb.onTranscriberStatus(s, d);
          if (s === "stopped") {
            this.browserCommand = null;
            if (finalText.trim()) this.cb.onCommandText(finalText.trim());
            else this.cb.onCommandTimeout();
          }
        },
      });
      this.browserCommand = t;
      t.start();
      setTimeout(() => this.browserCommand === t && t.stop(), 12_000);
      return;
    }
    this.recorder = new CommandRecorder(this.ring.drain(), this.clock);
  }

  /** Starts listening for a command without the wake word (e.g. after JARVIS asks "Yes?"). */
  armCommand() {
    if (!this.running || this.recorder) return;
    this.beginCommand(1);
  }

  private finishCommand(res: RecorderResult) {
    this.recorder = null;
    this.wake?.reset();
    if (res.kind === "no_speech") this.cb.onCommandTimeout();
    else this.cb.onCommandAudio(res.chunks, res.durationMs);
  }

  /** Adds the shared tab/system audio as a second, separately-labelled transcript source. */
  async startSystemAudio(language: string) {
    if (this.systemStream) return;
    const stream = await captureSystemAudio();
    this.systemStream = stream;
    const track = stream.getAudioTracks()[0];
    track.onended = () => void this.stopSystemAudio("Sharing ended.");
    this.systemTranscriber = new GeminiLiveTranscriber(language, {
      onInterim: (t) => this.cb.onInterim(t, "system"),
      onFinal: (t) => this.cb.onFinal(t, "system"),
      onStatus: (s, d) => s === "error" && this.cb.onSystemAudio(true, d),
    });
    try {
      await this.systemTranscriber.start();
      this.systemPipeline = await startPcmPipeline(track, (pcm) => this.systemTranscriber?.sendAudio(pcm.slice().buffer));
    } catch (e) {
      await this.stopSystemAudio();
      throw e;
    }
    this.cb.onSystemAudio(true);
  }

  async stopSystemAudio(detail?: string) {
    this.systemPipeline?.stop();
    this.systemPipeline = null;
    this.systemTranscriber?.stop();
    this.systemTranscriber = null;
    this.systemStream?.getTracks().forEach((t) => t.stop());
    this.systemStream = null;
    this.cb.onSystemAudio(false, detail);
  }

  private async teardownMic() {
    this.pipeline?.stop();
    this.pipeline = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.onended = null;
        t.stop();
      }
    }
    this.stream = null;
  }

  /** Stops all capture and processing immediately. */
  async stop() {
    this.running = false;
    this.recorder = null;
    this.browserCommand?.stop();
    this.browserCommand = null;
    this.transcriber?.stop();
    this.transcriber = null;
    this.wake?.reset();
    this.wake = null;
    this.ring.clear();
    await this.teardownMic();
    await this.stopSystemAudio();
    this.cb.onLevel(0);
    this.cb.onStatus("off");
  }
}
