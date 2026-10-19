"use client";

import { pcmToBase64 } from "./capture";

/**
 * Streaming speech-to-text with Gemini Transcribe Live over a WebSocket (ported from Crackin).
 *
 * The browser never sees the Gemini API key: each socket uses a single-use ephemeral
 * token from /api/live/token. Gemini limits a streaming session to 10 minutes, so the
 * transcriber opens a fresh socket before that (or when the server sends `goAway`)
 * and switches audio over without dropping speech.
 */

const WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const ROTATE_AFTER_MS = 9 * 60 * 1000;
const MAX_QUEUE_CHUNKS = 50; // ~5 s of audio buffered while (re)connecting
const MAX_RETRIES = 5;

export type TranscriberStatus = "connecting" | "live" | "reconnecting" | "error" | "stopped";

export interface TranscriberCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onStatus: (status: TranscriberStatus, detail?: string) => void;
}

interface TokenResponse {
  token: string;
  model: string;
  config: Record<string, unknown>;
}

interface ServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    inputTranscription?: { text?: string };
    interimInputTranscription?: { text?: string };
  };
  goAway?: { timeLeft?: string };
  error?: { message?: string };
}

async function fetchToken(language: string): Promise<TokenResponse> {
  const res = await fetch("/api/stt/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language }),
  });
  const data = (await res.json().catch(() => null)) as (TokenResponse & { message?: string; code?: string }) | null;
  if (!res.ok || !data?.token) {
    const err = new Error(data?.message ?? `Couldn't start transcription (${res.status}).`);
    (err as Error & { code?: string }).code = data?.code;
    throw err;
  }
  return data;
}

async function parseMessage(data: unknown): Promise<ServerMessage | null> {
  try {
    if (typeof data === "string") return JSON.parse(data) as ServerMessage;
    if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data)) as ServerMessage;
    if (data instanceof Blob) return JSON.parse(await data.text()) as ServerMessage;
  } catch {
    // Ignore malformed frames.
  }
  return null;
}

class LiveSocket {
  ws: WebSocket;
  ready: Promise<void>;
  closedByUs = false;

  constructor(
    token: TokenResponse,
    private handlers: {
      onMessage: (msg: ServerMessage) => void;
      onClose: (socket: LiveSocket, ev: CloseEvent) => void;
    },
  ) {
    this.ws = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(token.token)}`);
    this.ws.binaryType = "arraybuffer";
    this.ready = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Timed out connecting to Gemini.")), 15_000);
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ setup: { model: token.model, ...token.config } }));
      };
      this.ws.onmessage = async (ev) => {
        const msg = await parseMessage(ev.data);
        if (!msg) return;
        if (msg.setupComplete !== undefined) {
          window.clearTimeout(timer);
          resolve();
          return;
        }
        this.handlers.onMessage(msg);
      };
      this.ws.onclose = (ev) => {
        window.clearTimeout(timer);
        reject(new Error(ev.reason || `Connection closed (${ev.code}).`));
        this.handlers.onClose(this, ev);
      };
    });
    // Avoid unhandled-rejection noise; callers await `ready` themselves.
    this.ready.catch(() => {});
  }

  send(base64: string) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: base64, mimeType: "audio/pcm;rate=16000" } } }));
    }
  }

  /** Asks the server to finalize pending speech, then closes shortly after. */
  finish(delayMs = 2500) {
    this.closedByUs = true;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      window.setTimeout(() => this.ws.close(1000, "done"), delayMs);
    } else {
      this.ws.close();
    }
  }
}

export class GeminiLiveTranscriber {
  private active: LiveSocket | null = null;
  private pending: LiveSocket | null = null;
  private queue: string[] = [];
  private rotateTimer: number | null = null;
  private stopped = false;
  private retries = 0;

  constructor(
    private language: string,
    private cb: TranscriberCallbacks,
  ) {}

  async start() {
    this.cb.onStatus("connecting");
    await this.connect(false);
  }

  sendAudio(pcm: ArrayBuffer) {
    if (this.stopped) return;
    const b64 = pcmToBase64(pcm);
    if (this.active && this.active.ws.readyState === WebSocket.OPEN && !this.pending) {
      this.active.send(b64);
      return;
    }
    // While switching sockets, keep sending to the old one and buffer for the new one.
    this.active?.send(b64);
    this.queue.push(b64);
    if (this.queue.length > MAX_QUEUE_CHUNKS) this.queue.shift();
  }

  stop() {
    this.stopped = true;
    if (this.rotateTimer) window.clearTimeout(this.rotateTimer);
    this.pending?.finish(0);
    this.active?.finish();
    this.pending = null;
    this.active = null;
    this.queue = [];
    this.cb.onStatus("stopped");
  }

  private async connect(isRotation: boolean) {
    let socket: LiveSocket;
    try {
      const token = await fetchToken(this.language);
      if (this.stopped) return;
      socket = new LiveSocket(token, {
        onMessage: (msg) => this.handleMessage(msg),
        onClose: (s, ev) => this.handleClose(s, ev),
      });
      if (isRotation) this.pending = socket;
      await socket.ready;
    } catch (e) {
      this.pending = null;
      if (this.stopped) return;
      const code = (e as Error & { code?: string }).code;
      // Configuration problems won't fix themselves by retrying.
      if (code === "missing_key" || code === "bad_key" || code === "forbidden") {
        this.cb.onStatus("error", (e as Error).message);
        return;
      }
      this.scheduleRetry((e as Error).message);
      return;
    }
    if (this.stopped) {
      socket.finish(0);
      return;
    }

    const previous = this.active;
    this.active = socket;
    this.pending = null;
    this.retries = 0;
    // Replay audio captured while connecting so nothing said during the switch is lost.
    if (!previous || previous.ws.readyState !== WebSocket.OPEN) {
      for (const chunk of this.queue) socket.send(chunk);
    }
    this.queue = [];
    previous?.finish();
    this.cb.onStatus("live");

    if (this.rotateTimer) window.clearTimeout(this.rotateTimer);
    this.rotateTimer = window.setTimeout(() => void this.rotate(), ROTATE_AFTER_MS);
  }

  /** True while a socket is open and accepting audio. */
  get isLive(): boolean {
    return !!this.active && this.active.ws.readyState === WebSocket.OPEN;
  }

  private rotate() {
    if (this.stopped || this.pending) return;
    void this.connect(true);
  }

  private scheduleRetry(reason: string) {
    if (this.retries >= MAX_RETRIES) {
      this.cb.onStatus("error", `Transcription stopped: ${reason}`);
      return;
    }
    this.retries++;
    this.cb.onStatus("reconnecting", reason);
    const delay = Math.min(8000, 500 * 2 ** this.retries);
    window.setTimeout(() => {
      if (!this.stopped) void this.connect(false);
    }, delay);
  }

  private handleMessage(msg: ServerMessage) {
    const content = msg.serverContent;
    if (content?.interimInputTranscription?.text) this.cb.onInterim(content.interimInputTranscription.text);
    if (content?.inputTranscription?.text) {
      this.cb.onInterim("");
      this.cb.onFinal(content.inputTranscription.text);
    }
    if (msg.goAway) this.rotate();
  }

  private handleClose(socket: LiveSocket, ev: CloseEvent) {
    if (this.stopped || socket.closedByUs || socket !== this.active) return;
    this.active = null;
    this.scheduleRetry(ev.reason || `connection closed (${ev.code})`);
  }
}
