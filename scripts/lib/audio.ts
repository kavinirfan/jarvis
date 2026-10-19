import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Extracts the PCM "data" chunk from a 16-bit WAV file. */
export function wavData(wav: Buffer): Buffer {
  let off = 12;
  while (off < wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "data") return wav.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error("No audio data in WAV");
}

/** Synthesizes speech with macOS `say` as 16 kHz 16-bit mono PCM. */
export function say(text: string, voice?: string): Int16Array {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-say-"));
  const file = join(dir, "speech.wav");
  const args = ["-o", file, "--file-format=WAVE", "--data-format=LEI16@16000"];
  if (voice) args.push("-v", voice);
  execFileSync("say", [...args, text]);
  const pcm = wavData(readFileSync(file));
  return new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
}

export function silence(ms: number): Int16Array {
  return new Int16Array(Math.round((16000 * ms) / 1000));
}

export function concat(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
