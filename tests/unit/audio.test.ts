import { describe, expect, it } from "vitest";
import { derivePhase } from "@/lib/client/phase";
import { splitForSpeech } from "@/lib/client/speech/player";
import { CommandRecorder, containsWakeName, EnergyVad, overlapRatio, RingBuffer } from "@/lib/shared/vad";

const chunk = (n = 1600) => new Int16Array(n);

describe("voice activity detection", () => {
  it("adapts to background noise and detects louder speech", () => {
    const vad = new EnergyVad();
    for (let i = 0; i < 30; i++) vad.push(0.01); // steady room noise
    expect(vad.push(0.012)).toBe(false);
    expect(vad.push(0.12)).toBe(true);
  });
});

describe("pre-roll ring buffer", () => {
  it("keeps only the most recent audio", () => {
    const r = new RingBuffer(16000 * 1.5);
    for (let i = 0; i < 30; i++) r.push(chunk());
    const out = r.drain();
    const samples = out.reduce((n, c) => n + c.length, 0);
    expect(samples).toBeGreaterThanOrEqual(24000);
    expect(samples).toBeLessThan(24000 + 1600);
    expect(r.drain()).toHaveLength(0);
  });
});

describe("command recorder (after the wake word)", () => {
  it("ends after a pause following speech, including the pre-roll", () => {
    const rec = new CommandRecorder([chunk(), chunk()], 0, { endSilenceMs: 1000 });
    let t = 0;
    for (let i = 0; i < 10; i++) expect(rec.push(chunk(), true, (t += 100))).toBeNull();
    let res = null;
    for (let i = 0; i < 12 && !res; i++) res = rec.push(chunk(), false, (t += 100));
    expect(res?.kind).toBe("speech");
    if (res?.kind === "speech") expect(res.chunks.length).toBe(2 + 10 + 10);
  });

  it("gives up if nobody speaks", () => {
    const rec = new CommandRecorder([], 0, { noSpeechTimeoutMs: 3000 });
    let res = null;
    for (let t = 100; t <= 3000 && !res; t += 100) res = rec.push(chunk(), false, t);
    expect(res).toEqual({ kind: "no_speech" });
  });

  it("caps very long commands", () => {
    const rec = new CommandRecorder([], 0, { maxMs: 2000 });
    let res = null;
    for (let t = 100; t <= 2000 && !res; t += 100) res = rec.push(chunk(), true, t);
    expect(res?.kind).toBe("too_long");
  });
});

describe("wake-word verification and echo guard", () => {
  it("accepts transcriptions of Jarvis and rejects near-misses", () => {
    expect(containsWakeName("Hey Jarvis, what's up")).toBe(true);
    expect(containsWakeName("hey jervis what time is it")).toBe(true);
    expect(containsWakeName("Hey Travis, pass the salt")).toBe(false);
    expect(containsWakeName("harvest season")).toBe(false);
  });

  it("recognizes JARVIS's own speech in the transcript", () => {
    const spoken = "Mount Everest is 8,848 meters tall according to the 2020 survey.";
    expect(overlapRatio("mount everest is 8,848 meters tall according to the survey", spoken)).toBeGreaterThan(0.7);
    expect(overlapRatio("what should we have for dinner", spoken)).toBeLessThan(0.2);
  });
});

describe("speech chunking", () => {
  it("keeps the first chunk short so speech starts fast", () => {
    const parts = splitForSpeech("Canberra is the capital of Australia, chosen as a compromise between Sydney and Melbourne. It was purpose-built. Parliament moved there in 1927.");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBeLessThan(120);
    expect(parts.join(" ")).toContain("1927");
  });
});

describe("displayed phase", () => {
  const base = { capture: "off" as const, commandCapture: false, transcribing: false, busy: null, player: "idle" as const };
  it("prioritizes speaking > busy > capture state", () => {
    expect(derivePhase(base)).toBe("off");
    expect(derivePhase({ ...base, capture: "on" })).toBe("listening");
    expect(derivePhase({ ...base, capture: "on", commandCapture: true })).toBe("capturing");
    expect(derivePhase({ ...base, capture: "on", busy: "researching" })).toBe("researching");
    expect(derivePhase({ ...base, capture: "on", busy: "thinking", player: "speaking" })).toBe("speaking");
    expect(derivePhase({ ...base, capture: "error" })).toBe("error");
    expect(derivePhase({ ...base, capture: "standby" })).toBe("standby");
  });
});
