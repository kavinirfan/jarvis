"use client";

import type * as OrtTypes from "onnxruntime-web";
import { OpenWakeWord, type OrtLike, type WakeWordSessions } from "@/lib/shared/wakeword/openWakeWord";

/**
 * Loads the on-device "Hey JARVIS" detector. onnxruntime-web and the three models (~3.7 MB)
 * are served by this app (public/ort, public/models/wakeword) and cached by the browser;
 * audio never leaves the device for wake-word detection.
 */
let loading: Promise<{ ort: typeof OrtTypes; sessions: WakeWordSessions }> | null = null;

async function load() {
  // Imported at runtime from /public so the bundler never touches onnxruntime's wasm loader.
  const url = "/ort/ort.wasm.min.mjs";
  const ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url)) as typeof OrtTypes;
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1; // no SharedArrayBuffer / cross-origin isolation needed
  const opts: OrtTypes.InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  const [mel, embedding, wake] = await Promise.all([
    ort.InferenceSession.create("/models/wakeword/melspectrogram.onnx", opts),
    ort.InferenceSession.create("/models/wakeword/embedding_model.onnx", opts),
    ort.InferenceSession.create("/models/wakeword/hey_jarvis_v0.1.onnx", opts),
  ]);
  return { ort, sessions: { mel, embedding, wake } as unknown as WakeWordSessions };
}

export async function createWakeWordDetector(threshold: number): Promise<OpenWakeWord> {
  loading ??= load().catch((e) => {
    loading = null;
    throw e;
  });
  const { ort, sessions } = await loading;
  return new OpenWakeWord(ort as unknown as OrtLike, sessions, { threshold, cooldownMs: 2000 });
}
