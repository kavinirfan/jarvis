/**
 * Verifies the on-device "Hey JARVIS" detector with real synthesized speech (macOS `say`),
 * using the exact engine the browser runs. Prints per-utterance peak scores.
 *
 *   npm run check:wakeword
 */
import * as ort from "onnxruntime-node";
import { OpenWakeWord, type OrtLike } from "../src/lib/shared/wakeword/openWakeWord";
import { concat, say, silence } from "./lib/audio";

const DIR = "public/models/wakeword";
const VOICES = ["Samantha", "Daniel", "Karen", "Fred"];
const POSITIVE = ["Hey Jarvis", "Hey Jarvis, what time is it in Tokyo?"];
const NEGATIVE = [
  "Hey there, how are you doing today?",
  "The weather service says it will rain tomorrow.",
  "Harvest season starts in March.",
];
// Near-homophones the acoustic model can't always reject. JARVIS's second stage (checking the
// transcript for "Jarvis") filters these; here they are reported, not counted.
const NEAR_MISS = ["Hey Travis, can you pass the salt?"];

async function main() {
  const sessions = {
    mel: await ort.InferenceSession.create(`${DIR}/melspectrogram.onnx`),
    embedding: await ort.InferenceSession.create(`${DIR}/embedding_model.onnx`),
    wake: await ort.InferenceSession.create(`${DIR}/hey_jarvis_v0.1.onnx`),
  };
  const available = new Set(
    (await import("node:child_process")).execFileSync("say", ["-v", "?"]).toString().split("\n").map((l) => l.split(/\s{2,}/)[0].trim()),
  );
  const voices = VOICES.filter((v) => available.has(v));
  let pass = 0;
  let fail = 0;
  for (const [label, phrases, expected] of [["positive", POSITIVE, true], ["negative", NEGATIVE, false], ["nearmiss", NEAR_MISS, false]] as const) {
    for (const phrase of phrases) {
      for (const voice of voices) {
        const engine = new OpenWakeWord(ort as unknown as OrtLike, sessions);
        const audio = concat(silence(1500), say(phrase, voice), silence(1000));
        let peak = 0;
        let detected = false;
        // Feed 100 ms chunks, like the browser's AudioWorklet does.
        for (let i = 0; i < audio.length; i += 1600) {
          const r = await engine.process(audio.subarray(i, i + 1600));
          peak = Math.max(peak, ...r.scores, 0);
          detected ||= r.detected;
        }
        const ok = detected === expected;
        if (label !== "nearmiss") {
          if (ok) pass++;
          else fail++;
        }
        const tag = label === "nearmiss" ? (detected ? "INFO-TRIGGERED" : "INFO-REJECTED") : ok ? "PASS" : "FAIL";
        console.log(`${tag} ${label.padEnd(8)} ${voice.padEnd(9)} peak=${peak.toFixed(3)}  "${phrase}"`);
      }
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

void main();
