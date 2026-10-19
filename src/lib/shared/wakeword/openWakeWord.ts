/**
 * On-device "Hey JARVIS" detection with openWakeWord (https://github.com/dscripka/openWakeWord).
 *
 * Three small ONNX models run locally on 16 kHz audio:
 *   raw audio ──melspectrogram──▶ 32-bin mel frames (8 per 80 ms)
 *   last 76 mel frames ──embedding_model──▶ one 96-dim embedding per 80 ms
 *   last 16 embeddings ──hey_jarvis──▶ score 0..1
 *
 * Nothing here touches the network. The engine is runtime-agnostic: the browser passes
 * onnxruntime-web, tests pass onnxruntime-node.
 */

export const WAKE_SAMPLE_RATE = 16000;
/** openWakeWord processes audio in 80 ms frames. */
export const WAKE_FRAME_SAMPLES = 1280;

const MEL_BINS = 32;
const EMBEDDING_WINDOW = 76; // mel frames per embedding
const EMBEDDING_DIM = 96;
const MODEL_FRAMES = 16; // embeddings per wake-word prediction
const MEL_CONTEXT = 160 * 3; // extra samples so mel frames line up across chunks
const MAX_MEL_FRAMES = 970;
const WARMUP_PREDICTIONS = 5;

export interface OrtTensor {
  data: unknown;
  dims: readonly number[];
}
export interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
export interface OrtLike {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensor;
}

export interface WakeWordSessions {
  mel: OrtSession;
  embedding: OrtSession;
  wake: OrtSession;
}

export interface WakeWordOptions {
  /** Score at or above which the wake word fires. openWakeWord's default is 0.5. */
  threshold?: number;
  /** Minimum time between detections, in ms of audio. */
  cooldownMs?: number;
}

export class OpenWakeWord {
  private readonly threshold: number;
  private readonly cooldownFrames: number;
  private raw = new Float32Array(0); // pending samples not yet consumed (int16 scale)
  private context = new Float32Array(MEL_CONTEXT); // tail of the previous chunk
  private mel: Float32Array[] = [];
  private embeddings: Float32Array[] = [];
  private predictions = 0;
  private framesSinceFire = Number.POSITIVE_INFINITY;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(
    private ort: OrtLike,
    private sessions: WakeWordSessions,
    opts: WakeWordOptions = {},
  ) {
    this.threshold = opts.threshold ?? 0.5;
    this.cooldownFrames = Math.ceil((opts.cooldownMs ?? 2000) / 80);
    this.reset();
  }

  reset() {
    this.raw = new Float32Array(0);
    this.context = new Float32Array(MEL_CONTEXT);
    // openWakeWord starts the mel buffer with ones and the embedding buffer with zeros-ish
    // history; the warm-up below ignores the first predictions either way.
    this.mel = Array.from({ length: EMBEDDING_WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
    this.embeddings = Array.from({ length: MODEL_FRAMES }, () => new Float32Array(EMBEDDING_DIM));
    this.predictions = 0;
    this.framesSinceFire = Number.POSITIVE_INFINITY;
  }

  /**
   * Feeds 16 kHz mono audio (Int16 PCM or float -1..1). Calls are serialized internally.
   * Returns the score of every completed 80 ms frame and whether the wake word fired.
   */
  process(samples: Int16Array | Float32Array): Promise<{ scores: number[]; detected: boolean }> {
    const run = this.busy.then(() => this.processNow(samples));
    this.busy = run.catch(() => undefined);
    return run;
  }

  private async processNow(samples: Int16Array | Float32Array) {
    // openWakeWord's models expect int16-scaled values in float32.
    const scaled = new Float32Array(samples.length);
    if (samples instanceof Int16Array) scaled.set(samples);
    else for (let i = 0; i < samples.length; i++) scaled[i] = Math.max(-1, Math.min(1, samples[i])) * 32767;

    const merged = new Float32Array(this.raw.length + scaled.length);
    merged.set(this.raw);
    merged.set(scaled, this.raw.length);

    const scores: number[] = [];
    let detected = false;
    let offset = 0;
    while (merged.length - offset >= WAKE_FRAME_SAMPLES) {
      const frame = merged.subarray(offset, offset + WAKE_FRAME_SAMPLES);
      offset += WAKE_FRAME_SAMPLES;
      const score = await this.processFrame(frame);
      scores.push(score);
      this.framesSinceFire++;
      if (score >= this.threshold && this.framesSinceFire > this.cooldownFrames) {
        detected = true;
        this.framesSinceFire = 0;
      }
    }
    this.raw = merged.slice(offset);
    return { scores, detected };
  }

  private async processFrame(frame: Float32Array): Promise<number> {
    const { Tensor } = this.ort;

    // 1. Mel spectrogram over this frame plus a little context from the previous one.
    const melInput = new Float32Array(MEL_CONTEXT + WAKE_FRAME_SAMPLES);
    melInput.set(this.context);
    melInput.set(frame, MEL_CONTEXT);
    this.context = frame.slice(WAKE_FRAME_SAMPLES - MEL_CONTEXT);
    const melOut = await this.sessions.mel.run({
      [this.sessions.mel.inputNames[0]]: new Tensor("float32", melInput, [1, melInput.length]),
    });
    const melTensor = melOut[this.sessions.mel.outputNames[0]];
    const melData = melTensor.data as Float32Array;
    const nFrames = melData.length / MEL_BINS;
    for (let f = 0; f < nFrames; f++) {
      const row = new Float32Array(MEL_BINS);
      for (let b = 0; b < MEL_BINS; b++) row[b] = melData[f * MEL_BINS + b] / 10 + 2; // openWakeWord's transform
      this.mel.push(row);
    }
    if (this.mel.length > MAX_MEL_FRAMES) this.mel.splice(0, this.mel.length - MAX_MEL_FRAMES);

    // 2. One embedding from the most recent 76 mel frames.
    const window = new Float32Array(EMBEDDING_WINDOW * MEL_BINS);
    const start = this.mel.length - EMBEDDING_WINDOW;
    for (let i = 0; i < EMBEDDING_WINDOW; i++) window.set(this.mel[start + i], i * MEL_BINS);
    const embOut = await this.sessions.embedding.run({
      [this.sessions.embedding.inputNames[0]]: new Tensor("float32", window, [1, EMBEDDING_WINDOW, MEL_BINS, 1]),
    });
    const embedding = Float32Array.from((embOut[this.sessions.embedding.outputNames[0]].data as Float32Array).slice(0, EMBEDDING_DIM));
    this.embeddings.push(embedding);
    if (this.embeddings.length > MODEL_FRAMES) this.embeddings.shift();

    // 3. Wake-word score from the last 16 embeddings.
    const features = new Float32Array(MODEL_FRAMES * EMBEDDING_DIM);
    this.embeddings.forEach((e, i) => features.set(e, i * EMBEDDING_DIM));
    const out = await this.sessions.wake.run({
      [this.sessions.wake.inputNames[0]]: new Tensor("float32", features, [1, MODEL_FRAMES, EMBEDDING_DIM]),
    });
    const score = (out[this.sessions.wake.outputNames[0]].data as Float32Array)[0] ?? 0;
    this.predictions++;
    return this.predictions <= WARMUP_PREDICTIONS ? 0 : score;
  }
}
