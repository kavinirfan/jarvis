"use client";

/**
 * Audio capture (adapted from Crackin).
 *
 * - Microphone: getUserMedia with echo cancellation on, so JARVIS's own voice coming out of the
 *   speakers is largely removed from what the microphone hears.
 * - System / tab audio: the browser's share dialog (getDisplayMedia) with "Share tab audio" or
 *   "Share system audio". This is labelled "system" everywhere; it is never confused with the mic.
 */

export class CaptureError extends Error {
  constructor(
    public code: "unsupported" | "denied" | "no_audio" | "no_device" | "failed",
    message: string,
  ) {
    super(message);
  }
}

function describeMediaError(e: unknown, what: string): CaptureError {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return new CaptureError("denied", `${what} permission was denied. Allow it in the browser's site settings (the icon left of the address bar) and try again.`);
  if (name === "NotFoundError" || name === "OverconstrainedError") return new CaptureError("no_device", `No ${what.toLowerCase()} was found. Plug one in or pick another device.`);
  if (name === "NotReadableError") return new CaptureError("failed", `The ${what.toLowerCase()} is busy or unavailable (another app may be using it).`);
  return new CaptureError("failed", `Couldn't start the ${what.toLowerCase()}: ${(e as Error)?.message ?? e}`);
}

export function micSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
}

export function systemAudioSupported(): boolean {
  // Mobile browsers expose getDisplayMedia rarely and never with audio.
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export async function captureMic(deviceId?: string): Promise<MediaStream> {
  if (!micSupported()) throw new CaptureError("unsupported", "This browser can't capture microphone audio. Use a current Chrome, Edge, Safari or Firefox over HTTPS.");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
  } catch (e) {
    throw describeMediaError(e, "Microphone");
  }
}

/** Opens the browser's share dialog and returns only the shared tab/screen audio. */
export async function captureSystemAudio(): Promise<MediaStream> {
  if (!systemAudioSupported()) throw new CaptureError("unsupported", "This browser can't share tab or system audio. Use Chrome or Edge on a computer.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 1, max: 2 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      systemAudio: "include",
      selfBrowserSurface: "exclude",
    } as DisplayMediaStreamOptions);
  } catch (e) {
    throw describeMediaError(e, "Screen sharing");
  }
  const audio = stream.getAudioTracks()[0];
  // Video is required by the API but not needed: stop it immediately.
  stream.getVideoTracks().forEach((t) => t.stop());
  if (!audio) {
    throw new CaptureError("no_audio", "No audio was shared. Share again and turn on “Share tab audio” (or pick Entire screen and “Share system audio”).");
  }
  return new MediaStream([audio]);
}

export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
}

export interface PcmPipeline {
  context: AudioContext;
  stop: () => void;
}

/**
 * Streams a track as 16 kHz 16-bit PCM chunks (100 ms each) through an AudioWorklet.
 * `onChunk` gets the PCM and its RMS level (0..1). Nothing is played back.
 */
export async function startPcmPipeline(track: MediaStreamTrack, onChunk: (pcm: Int16Array, level: number) => void): Promise<PcmPipeline> {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
  } catch {
    ctx = new AudioContext(); // The worklet resamples if the browser won't run at 16 kHz.
  }
  await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const node = new AudioWorkletNode(ctx, "pcm-capture", { processorOptions: { targetRate: 16000, chunkMs: 100 } });
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => onChunk(new Int16Array(e.data.pcm), e.data.level);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(ctx.destination);
  if (ctx.state === "suspended") {
    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 2000))]);
    if ((ctx.state as AudioContextState) !== "running") {
      void ctx.close();
      throw new CaptureError("failed", "The browser blocked audio processing. Click anywhere on the page and press Enable Listening again.");
    }
  }
  return {
    context: ctx,
    stop: () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      void ctx.close();
    },
  };
}

export function pcmToBase64(pcm: ArrayBuffer | Int16Array): string {
  const bytes = pcm instanceof Int16Array ? new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) : new Uint8Array(pcm);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Encodes 16 kHz mono PCM as a WAV file. */
export function pcmToWav(chunks: Int16Array[], rate = 16000): Blob {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples * 2, true);
  let o = 44;
  for (const c of chunks) {
    new Int16Array(buf, o, c.length).set(c);
    o += c.length * 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}
