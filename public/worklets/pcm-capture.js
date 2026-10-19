/**
 * AudioWorklet that converts captured audio to 16 kHz, 16-bit mono PCM and posts
 * ~100 ms chunks to the main thread, plus a level reading for the meter.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetRate || 16000;
    this.ratio = sampleRate / this.targetRate;
    this.chunkSamples = Math.round((this.targetRate * (opts.chunkMs || 100)) / 1000);
    this.out = new Int16Array(this.chunkSamples);
    this.outIndex = 0;
    this.pos = 0; // fractional read position for resampling
    this.carry = 0; // last sample of the previous block, for interpolation
    this.levelSum = 0;
    this.levelCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    // Mix all channels down to mono.
    const frames = input[0].length;
    const mono = new Float32Array(frames);
    for (let c = 0; c < input.length; c++) {
      const ch = input[c];
      for (let i = 0; i < frames; i++) mono[i] += ch[i] / input.length;
    }

    // Linear-interpolation resample to the target rate.
    while (this.pos < frames) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i === 0 ? this.carry : mono[i - 1];
      const b = mono[i];
      let s = this.ratio === 1 ? b : a + (b - a) * frac;
      s = Math.max(-1, Math.min(1, s));
      this.levelSum += s * s;
      this.levelCount++;
      this.out[this.outIndex++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.outIndex === this.chunkSamples) {
        const buf = this.out.slice().buffer;
        this.port.postMessage({ pcm: buf, level: Math.sqrt(this.levelSum / this.levelCount) }, [buf]);
        this.outIndex = 0;
        this.levelSum = 0;
        this.levelCount = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= frames;
    this.carry = mono[frames - 1];
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
