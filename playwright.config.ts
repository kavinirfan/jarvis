import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests drive real Google Chrome against a running JARVIS server (npm run dev or
 * npm start). Set E2E_BASE_URL to point elsewhere. The microphone is Chrome's fake capture
 * device fed from e2e/fixtures/*.wav, so the full audio path (AudioWorklet → on-device wake word
 * → transcription) runs for real.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    channel: "chrome",
    permissions: ["microphone"],
    trace: "retain-on-failure",
  },
});
