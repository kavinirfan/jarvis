// Copies onnxruntime-web's WebAssembly files into public/ort so the wake-word
// engine loads them from this app instead of a third-party CDN.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = join("node_modules", "onnxruntime-web", "dist");
const dest = join("public", "ort");
if (!existsSync(src)) process.exit(0);
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src)) {
  if (/^(ort-wasm-simd-threaded\.(wasm|mjs)|ort\.wasm\.min\.mjs)$/.test(f)) cpSync(join(src, f), join(dest, f));
}
