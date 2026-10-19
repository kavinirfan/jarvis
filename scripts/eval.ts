/**
 * Evaluate a prompt/model configuration from the command line.
 *
 *   npm run eval                 # active config, real providers from .env.local, throwaway DB
 *   npm run eval -- --mock       # deterministic mock providers (CI)
 *   npm run eval -- --candidate '{"temperature":0.2}'   # compare active vs a candidate override
 *
 * Runs in a throwaway in-memory database, so it never touches your data and works while the
 * server is running. To evaluate your own approved examples, use Status → Run evaluation in the app.
 */
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--mock")) process.env.JARVIS_PROVIDER_MODE = "mock";
else if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { createDb, setDbForTests } = await import("../src/lib/server/db/client");
const { runEvaluation } = await import("../src/lib/server/eval/runner");
const { createCandidate, getActiveConfig } = await import("../src/lib/server/reasoning/promptConfig");

setDbForTests(createDb({ memory: true }));

function print(label: string, r: Awaited<ReturnType<typeof runEvaluation>>) {
  console.log(`\n=== ${label} (config ${r.version}) ===`);
  for (const c of r.results) {
    const s = Object.entries(c.scores).map(([k, v]) => `${k}=${(v as number).toFixed(2)}`).join(" ");
    console.log(`${c.error ? "ERR " : "    "}${c.id.padEnd(18)} ${c.mode.padEnd(9)} ${(c.latencyMs / 1000).toFixed(1).padStart(5)}s  ${s}${c.error ? `  ${c.error}` : ""}`);
  }
  console.log("scores:", Object.fromEntries(Object.entries(r.scores).map(([k, v]) => [k, Math.round(v * 100) / 100])));
}

const active = await getActiveConfig();
const base = await runEvaluation({ includeApproved: false });
print("active", base);

const idx = args.indexOf("--candidate");
if (idx >= 0) {
  const overrides = JSON.parse(args[idx + 1] ?? "{}");
  const version = `candidate-${Date.now()}`;
  await createCandidate(version, overrides, "CLI candidate");
  const cand = await runEvaluation({ version, includeApproved: false });
  print("candidate", cand);
  console.log("\ncomparison (candidate − active):");
  for (const k of Object.keys(base.scores)) {
    const d = (cand.scores[k] ?? 0) - base.scores[k];
    console.log(`  ${k.padEnd(11)} ${base.scores[k].toFixed(2)} → ${(cand.scores[k] ?? NaN).toFixed(2)}  (${d >= 0 ? "+" : ""}${d.toFixed(2)})`);
  }
  console.log(`\nTo adopt it, create the same version in the app and activate it; roll back any time (base: ${active.version}).`);
}
process.exit(0);
